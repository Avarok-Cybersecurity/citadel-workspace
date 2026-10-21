//! After an install: updates that wait for consent, consent, rollback, uninstall, and who may.

use super::test_manifests::*;
use super::test_support::{apps_keys, ask, Kernel};
use citadel_workspace_types::apps::{Capability, InstallScope};
use citadel_workspace_types::apps_install::{AppInstall, AppsRefusal, ConsentReason, InstallState};
use citadel_workspace_types::apps_protocol::AppsRequest;
use citadel_workspace_types::apps_responses::AppsResponse;
use citadel_workspace_types::structs::Permission;
use serde_json::json;

const CAPS: &[Capability] = &[Capability::Canvas, Capability::NodesRead];

/// A kernel serving `wasm(1)` and `wasm(2)`'s host, and `inst`'s workspace install of 1.0.0.
async fn installed(bytes: Vec<u8>) -> (Kernel, AppInstall) {
    let kernel = workspace_serving(bytes.clone()).await;
    let (key, spec) = (publisher(1), Spec::new("1.0.0"));
    let request = install_request(
        &spec,
        &key,
        signed(&spec, &key, &bytes),
        InstallScope::Workspace,
        CAPS,
        false,
    );
    match ask(&kernel, "inst", request).await {
        AppsResponse::Installed { install } => (kernel, install),
        other => panic!("{other:?}"),
    }
}

fn update_request(install: &AppInstall, spec: &Spec, key_seed: u8, bytes: &[u8]) -> AppsRequest {
    AppsRequest::Update {
        install_id: install.id.clone(),
        listing: signed(spec, &publisher(key_seed), bytes),
    }
}

fn updated(answer: AppsResponse) -> AppInstall {
    match answer {
        AppsResponse::Updated { install } => install,
        other => panic!("{other:?}"),
    }
}

#[tokio::test]
async fn an_update_asking_nothing_new_is_taken_and_equal_or_lower_versions_are_refused() {
    let bytes = wasm(1, 4096);
    let (kernel, install) = installed(bytes.clone()).await;
    for version in ["1.0.0", "0.9.0"] {
        let request = update_request(&install, &Spec::new(version), 1, &wasm(3, 64));
        assert_eq!(
            ask(&kernel, "inst", request).await,
            AppsResponse::Refused(AppsRefusal::VersionNotNewer),
            "{version}"
        );
    }
    upload(&kernel, "inst", &wasm(2, 4096)).await;
    let now = updated(
        ask(
            &kernel,
            "inst",
            update_request(&install, &Spec::new("1.1.0"), 1, &wasm(2, 4096)),
        )
        .await,
    );
    assert_eq!(
        (now.version.as_str(), &now.state),
        ("1.1.0", &InstallState::Active)
    );
    assert_eq!(
        now.previous.as_ref().map(|p| p.version.as_str()),
        Some("1.0.0")
    );
}

#[tokio::test]
async fn a_new_required_capability_waits_for_consent_and_the_old_version_keeps_running() {
    let (kernel, install) = installed(wasm(1, 4096)).await;
    let grown = Spec {
        capabilities: json!([
            { "cap": "canvas", "why": "Draws", "optional": false },
            { "cap": "nodes.read", "why": "Lists", "optional": false },
            { "cap": "storage.user", "why": "Widths", "optional": false }
        ]),
        ..Spec::new("1.1.0")
    };
    upload(&kernel, "inst", &wasm(2, 4096)).await;
    let waiting = updated(
        ask(
            &kernel,
            "inst",
            update_request(&install, &grown, 1, &wasm(2, 4096)),
        )
        .await,
    );
    assert_eq!(
        waiting.state,
        InstallState::NeedsConsent {
            version: "1.1.0".into(),
            reason: ConsentReason::CapabilitiesGrew
        }
    );
    assert_eq!(
        (waiting.version.as_str(), &waiting.artifact_sha256),
        ("1.0.0", &install.artifact_sha256)
    );
    assert_eq!(waiting.granted, install.granted);
    let consent = |user_caps: &[Capability]| AppsRequest::Consent {
        install_id: install.id.clone(),
        version: "1.1.0".into(),
        granted: user_caps.to_vec(),
        pinned_publisher_key: publisher(1).public_key_hex(),
    };
    let all = [
        Capability::Canvas,
        Capability::NodesRead,
        Capability::StorageUser,
    ];
    // `inst` may not grant storage; an AppManage holder may, but the install stays inst's and
    // inst could not grant it either.
    for who in ["inst", "mgr"] {
        assert_eq!(
            ask(&kernel, who, consent(&all)).await,
            AppsResponse::Refused(AppsRefusal::CapabilityNotGrantable(Capability::StorageUser)),
            "{who}"
        );
    }
    assert_eq!(
        ask(&kernel, "inst", consent(CAPS)).await,
        AppsResponse::Refused(AppsRefusal::RequiredCapabilityLeftOut(
            Capability::StorageUser
        ))
    );
}

#[tokio::test]
async fn a_different_publisher_key_waits_for_consent_with_its_reason() {
    let (kernel, install) = installed(wasm(1, 4096)).await;
    upload(&kernel, "inst", &wasm(2, 4096)).await;
    let waiting = updated(
        ask(
            &kernel,
            "inst",
            update_request(&install, &Spec::new("1.1.0"), 2, &wasm(2, 4096)),
        )
        .await,
    );
    assert_eq!(
        waiting.state,
        InstallState::NeedsConsent {
            version: "1.1.0".into(),
            reason: ConsentReason::PublisherKeyChanged
        }
    );
    assert_eq!(waiting.pinned_publisher_key, publisher(1).public_key_hex());
    let consent = |key: u8| AppsRequest::Consent {
        install_id: install.id.clone(),
        version: "1.1.0".into(),
        granted: CAPS.to_vec(),
        pinned_publisher_key: publisher(key).public_key_hex(),
    };
    assert_eq!(
        ask(&kernel, "inst", consent(1)).await,
        AppsResponse::Refused(AppsRefusal::BadSignature)
    );
    match ask(&kernel, "inst", consent(2)).await {
        AppsResponse::Consented { install: now } => {
            assert_eq!(
                (now.version.as_str(), &now.state),
                ("1.1.0", &InstallState::Active)
            );
            assert_eq!(now.pinned_publisher_key, publisher(2).public_key_hex());
        }
        other => panic!("{other:?}"),
    }
}

#[tokio::test]
async fn rollback_takes_app_manage_and_returns_to_the_previous_release() {
    let (kernel, install) = installed(wasm(1, 4096)).await;
    upload(&kernel, "inst", &wasm(2, 4096)).await;
    updated(
        ask(
            &kernel,
            "inst",
            update_request(&install, &Spec::new("1.1.0"), 1, &wasm(2, 4096)),
        )
        .await,
    );
    let rollback = || AppsRequest::Rollback {
        install_id: install.id.clone(),
    };
    assert_eq!(
        ask(&kernel, "inst", rollback()).await,
        AppsResponse::Refused(AppsRefusal::PermissionRequired(Permission::AppManage))
    );
    match ask(&kernel, "mgr", rollback()).await {
        AppsResponse::RolledBack { install: now } => {
            assert_eq!(
                (now.version.as_str(), &now.artifact_sha256),
                ("1.0.0", &install.artifact_sha256)
            );
        }
        other => panic!("{other:?}"),
    }
    let sha2 = hex::encode(citadel_app_signature::sha256(&wasm(2, 4096)));
    assert!(
        !apps_keys(&kernel).contains_key(&format!("citadel_workspace.apps.artifact.{sha2}")),
        "the rolled-back artifact is named by nothing and is gone"
    );
}

#[tokio::test]
async fn uninstall_takes_the_installer_or_app_manage_and_drops_what_nothing_names() {
    let (kernel, install) = installed(wasm(1, 4096)).await;
    let uninstall = || AppsRequest::Uninstall {
        install_id: install.id.clone(),
        purge_storage: false,
    };
    assert_eq!(
        ask(&kernel, "alice", uninstall()).await,
        AppsResponse::Refused(AppsRefusal::PermissionRequired(Permission::AppManage))
    );
    assert_eq!(
        ask(&kernel, "inst", uninstall()).await,
        AppsResponse::Uninstalled {
            install_id: install.id.clone()
        }
    );
    let left: Vec<String> = apps_keys(&kernel)
        .into_keys()
        .filter(|k| !k.ends_with(".audit") && !k.ends_with(".scopes"))
        .collect();
    assert!(left.is_empty(), "{left:?}");
    assert_eq!(
        ask(&kernel, "inst", uninstall()).await,
        AppsResponse::Refused(AppsRefusal::Unavailable)
    );
}

#[test]
fn an_uninstall_must_say_whether_to_purge_storage() {
    let without = json!({ "Uninstall": { "install_id": "i1" } });
    assert!(serde_json::from_value::<AppsRequest>(without).is_err());
    let with = json!({ "Uninstall": { "install_id": "i1", "purge_storage": false } });
    assert!(serde_json::from_value::<AppsRequest>(with).is_ok());
}
