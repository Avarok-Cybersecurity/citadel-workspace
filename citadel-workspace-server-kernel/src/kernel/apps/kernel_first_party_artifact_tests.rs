//! A recorded first-party release that is not a glue app brings its module like any other: an
//! install obtains the artifact its manifest names and checks it against its sha256. Only the
//! glue ABI's module is in the UI bundle (`install::stores_module`).
//!
//! The release is seeded into the workspace's record (`save_first_party_releases`, crate-private)
//! because provisioning, the record's only public writer, takes glue bundles alone.

use super::install::stores_module;
use super::records::{FirstPartyReleases, StoredRelease};
use super::test_manifests::*;
use super::test_support::{apps_keys, ask, workspace, Kernel};
use citadel_workspace_types::apps::{Capability, InstallScope};
use citadel_workspace_types::apps_install::{AppInstall, AppsRefusal, ListingSource};
use citadel_workspace_types::apps_manifest::{AppManifest, ABI_FIRST_PARTY_GLUE};
use citadel_workspace_types::apps_protocol::{AppsRequest, ListingOffer};
use citadel_workspace_types::apps_responses::AppsResponse;

const CANVAS_NODES: &[Capability] = &[Capability::Canvas, Capability::NodesRead];

/// `kernel` with `offer` recorded as a first-party release, as provisioning records one.
async fn record(kernel: &Kernel, spec: &Spec, offer: &ListingOffer) {
    let ListingOffer::Signed {
        manifest_bytes,
        signature,
    } = offer
    else {
        panic!("a signed offer")
    };
    let backend = &kernel.domain_operations.backend_tx_manager;
    let mut recorded: FirstPartyReleases = backend.first_party_releases().await.expect("read");
    let manifest = String::from_utf8(manifest_bytes.clone()).expect("utf-8");
    recorded.insert(
        spec.id.to_string(),
        StoredRelease {
            manifest,
            signature: signature.clone(),
        },
    );
    backend
        .save_first_party_releases(&recorded)
        .await
        .expect("save");
}

async fn installs_of(kernel: &Kernel, app_id: &str) -> Vec<AppInstall> {
    match ask(kernel, "inst", AppsRequest::ListInstalls).await {
        AppsResponse::Installs { installs, .. } => installs
            .into_iter()
            .filter(|i| i.app_id == app_id)
            .collect(),
        other => panic!("no installs: {other:?}"),
    }
}

#[tokio::test]
async fn a_first_party_worker_release_installs_only_with_the_artifact_it_names() {
    let (key, bytes, spec) = (publisher(1), wasm(1, 4096), Spec::new("1.0.0"));
    let offer = signed(&spec, &key, &bytes);
    let request = || {
        install_request(
            &spec,
            &key,
            offer.clone(),
            InstallScope::Workspace,
            CANVAS_NODES,
            false,
        )
    };

    // No artifact anywhere: refused as any install without its module is, and nothing installed.
    let kernel = workspace().await;
    record(&kernel, &spec, &offer).await;
    assert_eq!(
        refused(&ask(&kernel, "inst", request()).await),
        Some(&AppsRefusal::ServerFeatureUnavailable)
    );
    assert!(installs_of(&kernel, spec.id).await.is_empty());

    // Bytes that are not the manifest's: the sha256 check refuses them, and nothing installed.
    let kernel = workspace_serving(wasm(2, 4096)).await;
    record(&kernel, &spec, &offer).await;
    assert_eq!(
        refused(&ask(&kernel, "inst", request()).await),
        Some(&AppsRefusal::ArtifactMismatch)
    );
    assert!(installs_of(&kernel, spec.id).await.is_empty());

    // Uploaded through the normal path: installed as first-party, its artifact stored by sha256.
    let kernel = workspace().await;
    record(&kernel, &spec, &offer).await;
    assert!(matches!(
        upload(&kernel, "inst", &bytes).await,
        AppsResponse::ArtifactChunkStored { .. }
    ));
    assert!(installed(&ask(&kernel, "inst", request()).await));
    let sha = hex::encode(citadel_app_signature::sha256(&bytes));
    assert!(apps_keys(&kernel).contains_key(&format!("citadel_workspace.apps.artifact.{sha}")));
    let installs = installs_of(&kernel, spec.id).await;
    assert_eq!(installs.len(), 1);
    assert_eq!(
        installs[0].source,
        ListingSource::FirstParty,
        "the recorded release, not a registry one"
    );
}

#[test]
fn only_the_glue_abi_leaves_its_module_to_the_ui_bundle() {
    let bytes = manifest(&Spec::new("1.0.0"), &publisher(1), &wasm(1, 64));
    let mut value: serde_json::Value = serde_json::from_slice(&bytes).expect("json");
    let as_manifest =
        |v: &serde_json::Value| serde_json::from_value::<AppManifest>(v.clone()).expect("manifest");
    assert!(stores_module(&as_manifest(&value)), "ABI 1");
    value["sdk"]["abi"] = ABI_FIRST_PARTY_GLUE.into();
    assert!(!stores_module(&as_manifest(&value)), "the glue ABI");
}
