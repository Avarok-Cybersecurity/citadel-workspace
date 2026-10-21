//! What a member reads about installs: only those that concern them.

use super::test_manifests::*;
use super::test_support::{ask, workspace, Kernel};
use citadel_workspace_types::apps::{Capability, InstallScope};
use citadel_workspace_types::apps_install::{AppInstall, AppsRefusal};
use citadel_workspace_types::apps_protocol::{AppsRequest, IhttpAddress, ListingOffer};
use citadel_workspace_types::apps_responses::{AppsAuditEvent, AppsResponse};
use citadel_workspace_types::structs::Permission;
use serde_json::json;

/// alice's own install of a canvas-only 1.0.0, from an upload.
async fn alices() -> (Kernel, AppInstall, ListingOffer, Vec<u8>) {
    let kernel = workspace().await;
    let (key, bytes) = (publisher(1), wasm(1, 4096));
    let spec = Spec {
        capabilities: json!([{ "cap": "canvas", "why": "Draws", "optional": false }]),
        ..Spec::new("1.0.0")
    };
    upload(&kernel, "alice", &bytes).await;
    let offer = signed(&spec, &key, &bytes);
    let scope = InstallScope::SelfOnly("alice".into());
    let request = install_request(
        &spec,
        &key,
        offer.clone(),
        scope,
        &[Capability::Canvas],
        false,
    );
    match ask(&kernel, "alice", request).await {
        AppsResponse::Installed { install } => (kernel, install, offer, bytes),
        other => panic!("{other:?}"),
    }
}

fn ids(answer: &AppsResponse) -> (Vec<String>, Vec<String>) {
    match answer {
        AppsResponse::Installs {
            installs,
            disabled_for_me,
        } => (
            installs.iter().map(|i| i.id.clone()).collect(),
            disabled_for_me.clone(),
        ),
        other => panic!("{other:?}"),
    }
}

#[tokio::test]
async fn an_install_is_listed_to_whom_it_concerns_and_hidden_for_oneself_only() {
    let (kernel, install, _, _) = alices().await;
    let mine = vec![install.id.clone()];
    assert_eq!(
        ids(&ask(&kernel, "alice", AppsRequest::ListInstalls).await),
        (mine.clone(), vec![])
    );
    assert_eq!(
        ids(&ask(&kernel, "bob", AppsRequest::ListInstalls).await),
        (vec![], vec![])
    );
    assert_eq!(
        ids(&ask(&kernel, "mgr", AppsRequest::ListInstalls).await),
        (mine.clone(), vec![])
    );
    let hide = |disabled| AppsRequest::SetDisabledForMe {
        install_id: install.id.clone(),
        disabled,
    };
    assert_eq!(
        ask(&kernel, "bob", hide(true)).await,
        AppsResponse::Refused(AppsRefusal::Unavailable)
    );
    // mgr sees every install, and hides only what reaches them.
    assert_eq!(
        ask(&kernel, "mgr", hide(true)).await,
        AppsResponse::Refused(AppsRefusal::Unavailable)
    );
    ask(&kernel, "alice", hide(true)).await;
    assert_eq!(
        ids(&ask(&kernel, "alice", AppsRequest::ListInstalls).await),
        (mine.clone(), mine)
    );
    ask(&kernel, "alice", hide(false)).await;
    assert_eq!(
        ids(&ask(&kernel, "alice", AppsRequest::ListInstalls).await).1,
        Vec::<String>::new()
    );
}

#[tokio::test]
async fn the_release_and_its_artifact_go_to_whom_the_install_concerns() {
    let (kernel, install, offer, bytes) = alices().await;
    let ListingOffer::Signed {
        manifest_bytes,
        signature,
    } = offer
    else {
        unreachable!()
    };
    match ask(
        &kernel,
        "alice",
        AppsRequest::GetRelease {
            install_id: install.id.clone(),
        },
    )
    .await
    {
        AppsResponse::Release {
            current,
            waiting_on,
            ..
        } => {
            assert_eq!(
                (current.manifest_bytes, current.signature),
                (manifest_bytes, signature)
            );
            assert_eq!(waiting_on, None);
        }
        other => panic!("{other:?}"),
    }
    let release = AppsRequest::GetRelease {
        install_id: install.id.clone(),
    };
    assert_eq!(
        ask(&kernel, "bob", release).await,
        AppsResponse::Refused(AppsRefusal::Unavailable)
    );
    let fetch = |sha256: &str| AppsRequest::FetchArtifact {
        sha256: sha256.to_string(),
        index: 0,
    };
    match ask(&kernel, "alice", fetch(&install.artifact_sha256)).await {
        AppsResponse::ArtifactChunk {
            bytes: got,
            total_chunks: 1,
            ..
        } => assert_eq!(got, bytes),
        other => panic!("{other:?}"),
    }
    let hidden = ask(&kernel, "bob", fetch(&install.artifact_sha256)).await;
    assert_eq!(hidden, AppsResponse::Refused(AppsRefusal::Unavailable));
    assert_eq!(hidden, ask(&kernel, "bob", fetch(&"0".repeat(64))).await);
}

#[tokio::test]
async fn the_audit_log_is_for_app_manage_newest_first() {
    let (kernel, install, _, _) = alices().await;
    let audit = AppsRequest::ListAudit { before_ms: None };
    assert_eq!(
        ask(&kernel, "alice", audit.clone()).await,
        AppsResponse::Refused(AppsRefusal::PermissionRequired(Permission::AppManage))
    );
    ask(
        &kernel,
        "alice",
        AppsRequest::Uninstall {
            install_id: install.id.clone(),
            purge_storage: true,
        },
    )
    .await;
    match ask(&kernel, "mgr", audit).await {
        AppsResponse::Audit { entries } => {
            let events: Vec<&AppsAuditEvent> = entries.iter().map(|e| &e.event).collect();
            assert!(
                matches!(
                    events[..],
                    [
                        AppsAuditEvent::Uninstalled {
                            purged_storage: true
                        },
                        AppsAuditEvent::Installed { .. }
                    ]
                ),
                "{events:?}"
            );
        }
        other => panic!("{other:?}"),
    }
}

#[tokio::test]
async fn requests_this_server_does_not_take_are_typed_refusals() {
    let kernel = workspace().await;
    let request = AppsRequest::RequestInstall {
        app_id: "com.acme.kanban".into(),
        node_id: "office".into(),
    };
    assert_eq!(
        ask(&kernel, "alice", request).await,
        AppsResponse::Refused(AppsRefusal::InstallRequestsNotOffered)
    );
    for request in [
        AppsRequest::Call {
            install_id: "i".into(),
            call: vec![],
        },
        AppsRequest::AdvertiseService {
            install_id: "i".into(),
            routes_digest: "0".repeat(64),
            until_ms: 0,
        },
        AppsRequest::IhttpSend {
            from_install_id: "i".into(),
            to: IhttpAddress::User {
                app_id: "com.acme.kanban".into(),
                username: "bob".into(),
            },
            frame: vec![],
        },
    ] {
        assert_eq!(
            ask(&kernel, "alice", request).await,
            AppsResponse::Refused(AppsRefusal::ServerFeatureUnavailable)
        );
    }
}
