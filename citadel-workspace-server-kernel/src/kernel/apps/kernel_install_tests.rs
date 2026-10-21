//! Installing through the kernel: each refusal beside the request that differs only in the
//! refused part and is accepted.

use super::test_manifests::*;
use super::test_support::{ask, workspace};
use citadel_workspace_types::apps::{Capability, InstallScope};
use citadel_workspace_types::apps_install::AppsRefusal;
use citadel_workspace_types::structs::Permission;
use serde_json::json;

const CANVAS_NODES: &[Capability] = &[Capability::Canvas, Capability::NodesRead];

#[tokio::test]
async fn a_member_installs_for_themselves_from_an_upload_and_not_for_the_workspace() {
    let (key, bytes, spec) = (publisher(1), wasm(1, 4096), Spec::new("1.0.0"));
    let kernel = workspace().await;
    let mine = InstallScope::SelfOnly("alice".into());
    let canvas = &[Capability::Canvas, Capability::NodesRead];
    let request = |scope| {
        install_request(
            &spec,
            &key,
            signed(&spec, &key, &bytes),
            scope,
            canvas,
            false,
        )
    };
    // Members hold AppInstall but no AppInstallAllowNodeRead.
    let answer = ask(&kernel, "alice", request(mine.clone())).await;
    assert_eq!(
        refused(&answer),
        Some(&AppsRefusal::CapabilityNotGrantable(Capability::NodesRead))
    );

    let spec = Spec {
        capabilities: json!([{ "cap": "canvas", "why": "Draws", "optional": false }]),
        ..spec
    };
    upload(&kernel, "alice", &bytes).await;
    let request = |scope| {
        install_request(
            &spec,
            &key,
            signed(&spec, &key, &bytes),
            scope,
            &[Capability::Canvas],
            false,
        )
    };
    let answer = ask(&kernel, "alice", request(InstallScope::Workspace)).await;
    assert_eq!(
        refused(&answer),
        Some(&AppsRefusal::PermissionRequired(
            Permission::AppInstallScoped
        ))
    );
    let answer = ask(&kernel, "alice", request(mine)).await;
    assert!(installed(&answer), "{answer:?}");
}

#[tokio::test]
async fn an_installer_grants_only_what_their_app_install_allows() {
    let (key, bytes, spec) = (publisher(1), wasm(1, 4096), Spec::new("1.0.0"));
    let kernel = workspace_serving(bytes.clone()).await;
    let with_storage = [
        Capability::Canvas,
        Capability::NodesRead,
        Capability::StorageUser,
    ];
    let answer = ask(
        &kernel,
        "inst",
        install_request(
            &spec,
            &key,
            signed(&spec, &key, &bytes),
            InstallScope::Workspace,
            &with_storage,
            false,
        ),
    )
    .await;
    assert_eq!(
        refused(&answer),
        Some(&AppsRefusal::CapabilityNotGrantable(
            Capability::StorageUser
        ))
    );
    let answer = ask(
        &kernel,
        "inst",
        install_request(
            &spec,
            &key,
            signed(&spec, &key, &bytes),
            InstallScope::Workspace,
            CANVAS_NODES,
            false,
        ),
    )
    .await;
    assert!(installed(&answer), "{answer:?}");
}

#[tokio::test]
async fn the_installer_pins_the_key_and_another_keys_signature_is_refused() {
    let (key, other, bytes, spec) = (
        publisher(1),
        publisher(2),
        wasm(1, 4096),
        Spec::new("1.0.0"),
    );
    let kernel = workspace_serving(bytes.clone()).await;
    let scope = InstallScope::Workspace;
    // The consent screen showed `other`'s key; the manifest is `key`'s.
    let mut request = install_request(
        &spec,
        &key,
        signed(&spec, &key, &bytes),
        scope.clone(),
        CANVAS_NODES,
        false,
    );
    if let citadel_workspace_types::apps_protocol::AppsRequest::Install {
        pinned_publisher_key,
        ..
    } = &mut request
    {
        *pinned_publisher_key = other.public_key_hex();
    }
    assert_eq!(
        refused(&ask(&kernel, "inst", request).await),
        Some(&AppsRefusal::BadSignature)
    );
    // A manifest naming `key`, signed by `other`.
    let forged = match (signed(&spec, &key, &bytes), signed(&spec, &other, &bytes)) {
        (
            citadel_workspace_types::apps_protocol::ListingOffer::Signed { manifest_bytes, .. },
            citadel_workspace_types::apps_protocol::ListingOffer::Signed { signature, .. },
        ) => citadel_workspace_types::apps_protocol::ListingOffer::Signed {
            manifest_bytes,
            signature,
        },
        _ => unreachable!(),
    };
    let request = install_request(&spec, &key, forged, scope.clone(), CANVAS_NODES, false);
    assert_eq!(
        refused(&ask(&kernel, "inst", request).await),
        Some(&AppsRefusal::BadSignature)
    );
    let request = install_request(
        &spec,
        &key,
        signed(&spec, &key, &bytes),
        scope,
        CANVAS_NODES,
        false,
    );
    assert!(installed(&ask(&kernel, "inst", request).await));
}
