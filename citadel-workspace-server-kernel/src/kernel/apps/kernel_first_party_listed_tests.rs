//! A first-party release on the app ABI is listed, not installed: provisioning stores the module
//! the bundle carries, so an admin's install at a node finds it `Stored` with no upload and no
//! fetcher (`workspace()` has none), and an uninstall does not sweep it. Refused, and nothing
//! listed or stored, when another key signed it or the module is missing or not the manifest's.

use super::first_party::{plan_provisioning, Provisioning, SignedBundle};
use super::test_manifests::*;
use super::test_support::{apps_keys, ask, workspace, Kernel};
use citadel_app_signature::{sha256, AppSigningKey, ArtifactDigests};
use citadel_sdk::prelude::NetworkError;
use citadel_workspace_types::apps::{Capability, InstallScope};
use citadel_workspace_types::apps_install::{AppsRefusal, ListingSource};
use citadel_workspace_types::apps_manifest::ABI_FIRST_PARTY_GLUE;
use citadel_workspace_types::apps_protocol::{AppsRequest, ListingOffer};
use citadel_workspace_types::apps_responses::{AppListing, AppsResponse};

const CANVAS_NODES: &[Capability] = &[Capability::Canvas, Capability::NodesRead];

/// `spec` published by `key` over `module`: the manifest bytes and the signature.
fn release(spec: &Spec, key: &AppSigningKey, module: &[u8]) -> (Vec<u8>, String) {
    let ListingOffer::Signed {
        manifest_bytes,
        signature,
    } = signed(spec, key, module)
    else {
        panic!("a signed offer")
    };
    (manifest_bytes, signature)
}

async fn provision(
    kernel: &Kernel,
    (manifest, signature): &(Vec<u8>, String),
    module: Option<&[u8]>,
    trusted: &AppSigningKey,
) -> Result<(), NetworkError> {
    let bundle = SignedBundle {
        manifest,
        signature,
        module,
    };
    let key = trusted.public_key_hex();
    kernel
        .provision_first_party_apps(&[("kanban", bundle)], &[key.as_str()])
        .await
}

async fn listed(kernel: &Kernel) -> Vec<AppListing> {
    match ask(kernel, "boss", AppsRequest::ListCatalogue).await {
        AppsResponse::Catalogue { listings } => listings
            .into_iter()
            .filter(|l| l.source == ListingSource::FirstParty)
            .collect(),
        other => panic!("no catalogue: {other:?}"),
    }
}

async fn install_count(kernel: &Kernel) -> usize {
    match ask(kernel, "boss", AppsRequest::ListInstalls).await {
        AppsResponse::Installs { installs, .. } => installs.len(),
        other => panic!("no installs: {other:?}"),
    }
}

fn stored(kernel: &Kernel, module: &[u8]) -> bool {
    let sha = hex::encode(sha256(module));
    apps_keys(kernel).contains_key(&format!("citadel_workspace.apps.artifact.{sha}"))
}

fn install_at_office(spec: &Spec, key: &AppSigningKey, module: &[u8]) -> AppsRequest {
    let offer = signed(spec, key, module);
    let office = InstallScope::Node("office".into());
    install_request(spec, key, offer, office, CANVAS_NODES, false)
}

#[tokio::test]
async fn listed_with_its_module_stored_and_installed_by_an_admin_at_a_node() {
    let (key, module, spec) = (publisher(1), wasm(1, 4096), Spec::new("1.0.0"));
    let kernel = workspace().await;
    let signed_release = release(&spec, &key, &module);
    let listing = provision(&kernel, &signed_release, Some(&module), &key).await;
    listing.expect("listed");

    let [listing] = listed(&kernel).await.try_into().expect("one listing");
    assert_eq!(listing.manifest_bytes, signed_release.0, "the signed bytes");
    assert_eq!(install_count(&kernel).await, 0, "listed, not installed");
    assert!(stored(&kernel, &module), "its module is stored");
    let backend = &kernel.domain_operations.backend_tx_manager;
    let audit = backend.apps_audit().await.expect("audit");
    assert!(
        audit.is_empty(),
        "nothing installed, nothing audited: {audit:?}"
    );

    let answer = ask(&kernel, "boss", install_at_office(&spec, &key, &module)).await;
    let AppsResponse::Installed { install } = answer else {
        panic!("not installed from the stored module: {answer:?}")
    };
    assert_eq!(install.source, ListingSource::FirstParty);
    assert_eq!(install.scope, InstallScope::Node("office".into()));
}

#[tokio::test]
async fn an_uninstall_leaves_the_listed_module_for_the_next_install() {
    let (key, module, spec) = (publisher(1), wasm(1, 4096), Spec::new("1.0.0"));
    let kernel = workspace().await;
    let signed_release = release(&spec, &key, &module);
    let listing = provision(&kernel, &signed_release, Some(&module), &key).await;
    listing.expect("listed");
    let answer = ask(&kernel, "boss", install_at_office(&spec, &key, &module)).await;
    let AppsResponse::Installed { install } = answer else {
        panic!("not installed: {answer:?}")
    };
    let uninstall = AppsRequest::Uninstall {
        install_id: install.id,
        purge_storage: false,
    };
    let answer = ask(&kernel, "boss", uninstall).await;
    assert!(
        matches!(answer, AppsResponse::Uninstalled { .. }),
        "{answer:?}"
    );
    assert!(
        stored(&kernel, &module),
        "the sweep keeps a listed release's module"
    );
    let again = ask(&kernel, "boss", install_at_office(&spec, &key, &module)).await;
    assert!(installed(&again), "{again:?}");
}

#[tokio::test]
async fn a_release_another_key_signed_or_without_its_module_is_refused_and_nothing_listed() {
    let (key, module, spec) = (publisher(1), wasm(1, 4096), Spec::new("1.0.0"));
    let other_module = wasm(2, 4096);
    let signed_release = release(&spec, &key, &module);
    let cases: [(Option<&[u8]>, AppSigningKey); 3] = [
        (Some(&module), publisher(2)),
        (None, publisher(1)),
        (Some(&other_module), publisher(1)),
    ];
    for (carried, trusted) in cases {
        let kernel = workspace().await;
        let refused = provision(&kernel, &signed_release, carried, &trusted).await;
        let len = carried.map(<[u8]>::len);
        assert!(
            refused.is_err(),
            "provisioned with a module of {len:?} bytes"
        );
        assert!(listed(&kernel).await.is_empty());
        assert!(!stored(&kernel, &module) && !stored(&kernel, &other_module));
    }
}

#[test]
fn each_refusal_is_the_decisions_own() {
    let (key, module, spec) = (publisher(1), wasm(1, 4096), Spec::new("1.0.0"));
    let (manifest, signature) = release(&spec, &key, &module);
    let plan = |module: Option<&[u8]>, trusted: &AppSigningKey| {
        let bundle = SignedBundle {
            manifest: &manifest,
            signature: &signature,
            module,
        };
        let trusted = trusted.public_key_hex();
        plan_provisioning(&bundle, &[trusted.as_str()]).map(|p| match p {
            Provisioning::List { .. } => "list",
            Provisioning::Install(_) => "install",
        })
    };
    assert_eq!(plan(Some(&module), &key), Ok("list"));
    assert!(matches!(
        plan(Some(&module), &publisher(2)),
        Err(AppsRefusal::InvalidManifest(_))
    ));
    assert_eq!(plan(None, &key), Err(AppsRefusal::ArtifactUnreachable));
    let mismatch = Err(AppsRefusal::ArtifactMismatch);
    assert_eq!(plan(Some(&wasm(2, 4096)), &key), mismatch);
    assert_eq!(plan(Some(&module[..module.len() - 1]), &key), mismatch);
}

#[test]
fn a_glue_release_carrying_a_module_is_refused_and_without_one_is_installed() {
    let (key, module, spec) = (publisher(1), wasm(1, 4096), Spec::new("1.0.0"));
    let mut value: serde_json::Value =
        serde_json::from_slice(&manifest(&spec, &key, &module)).expect("json");
    value["sdk"]["abi"] = ABI_FIRST_PARTY_GLUE.into();
    let bytes = serde_json::to_vec(&value).expect("json");
    let digests = ArtifactDigests::of(&bytes, &module);
    let signature = key.sign(spec.id, spec.version, &digests).expect("sign");
    let trusted = key.public_key_hex();
    let plan = |module: Option<&[u8]>| {
        let bundle = SignedBundle {
            manifest: &bytes,
            signature: &signature,
            module,
        };
        let planned = plan_provisioning(&bundle, &[trusted.as_str()]);
        planned.map(|p| matches!(p, Provisioning::Install(_)))
    };
    assert!(matches!(
        plan(Some(&module)),
        Err(AppsRefusal::InvalidManifest(_))
    ));
    assert_eq!(plan(None), Ok(true));
}

#[tokio::test]
async fn a_second_pass_changes_nothing_and_a_newer_release_replaces_the_listed_one() {
    let (key, module, spec) = (publisher(1), wasm(1, 4096), Spec::new("1.0.0"));
    let kernel = workspace().await;
    let first = release(&spec, &key, &module);
    provision(&kernel, &first, Some(&module), &key)
        .await
        .expect("listed");
    let before = apps_keys(&kernel);
    provision(&kernel, &first, Some(&module), &key)
        .await
        .expect("listed again");
    assert_eq!(
        apps_keys(&kernel),
        before,
        "a restart's pass changes nothing"
    );

    let (newer_module, newer_spec) = (wasm(3, 4096), Spec::new("1.1.0"));
    let newer = release(&newer_spec, &key, &newer_module);
    provision(&kernel, &newer, Some(&newer_module), &key)
        .await
        .expect("listed");
    let [listing] = listed(&kernel).await.try_into().expect("one listing");
    assert_eq!(
        listing.manifest_bytes, newer.0,
        "the newer release is the one listed"
    );
    assert!(stored(&kernel, &newer_module));
    assert_eq!(install_count(&kernel).await, 0);
}
