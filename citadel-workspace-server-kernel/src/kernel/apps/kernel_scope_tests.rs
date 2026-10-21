//! Installing through the kernel: where an install may reach, who may be granted `documents`,
//! and one install per app and scope.

use super::test_manifests::*;
use super::test_support::{apps_keys, ask};
use citadel_workspace_types::apps::{Capability, InstallScope};
use citadel_workspace_types::apps_install::AppsRefusal;
use serde_json::json;

const CANVAS_NODES: &[Capability] = &[Capability::Canvas, Capability::NodesRead];

#[tokio::test]
async fn a_scope_must_stay_inside_the_audience() {
    let (key, bytes) = (publisher(1), wasm(1, 4096));
    let spec = Spec {
        audience: json!({ "kind": "members", "usernames": ["alice", "inst"] }),
        ..Spec::new("1.0.0")
    };
    let kernel = workspace_serving(bytes.clone()).await;
    let request = |scope| {
        install_request(
            &spec,
            &key,
            signed(&spec, &key, &bytes),
            scope,
            CANVAS_NODES,
            false,
        )
    };
    assert_eq!(
        refused(&ask(&kernel, "inst", request(InstallScope::Workspace)).await),
        Some(&AppsRefusal::ScopeOutsideAudience)
    );
    assert!(installed(
        &ask(
            &kernel,
            "inst",
            request(InstallScope::Users(vec!["alice".into()]))
        )
        .await
    ));
}

#[tokio::test]
async fn documents_is_for_the_first_party_publisher_only() {
    let (key, bytes) = (publisher(1), wasm(1, 4096));
    let caps = json!([{ "cap": "canvas", "why": "Draws", "optional": false }, { "cap": "documents", "why": "Edits", "optional": true }]);
    let spec = Spec {
        capabilities: caps,
        ..Spec::new("1.0.0")
    };
    let kernel = workspace_serving(bytes.clone()).await;
    let request = |granted: &[Capability]| {
        install_request(
            &spec,
            &key,
            signed(&spec, &key, &bytes),
            InstallScope::Workspace,
            granted,
            false,
        )
    };
    let answer = ask(
        &kernel,
        "boss",
        request(&[Capability::Canvas, Capability::Documents]),
    )
    .await;
    assert_eq!(
        refused(&answer),
        Some(&AppsRefusal::FirstPartyOnly(Capability::Documents))
    );
    assert!(installed(
        &ask(&kernel, "boss", request(&[Capability::Canvas])).await
    ));
}

#[tokio::test]
async fn two_installs_of_one_app_at_one_scope_make_one_record() {
    let (key, bytes, spec) = (publisher(1), wasm(1, 4096), Spec::new("1.0.0"));
    let kernel = workspace_serving(bytes.clone()).await;
    let request = || {
        install_request(
            &spec,
            &key,
            signed(&spec, &key, &bytes),
            InstallScope::Workspace,
            CANVAS_NODES,
            false,
        )
    };
    let (first, second) = tokio::join!(
        ask(&kernel, "inst", request()),
        ask(&kernel, "boss", request())
    );
    let outcomes = [&first, &second];
    assert_eq!(
        outcomes.iter().filter(|a| installed(a)).count(),
        1,
        "{outcomes:?}"
    );
    assert_eq!(
        outcomes
            .iter()
            .filter(|a| matches!(refused(a), Some(AppsRefusal::AlreadyInstalled { .. })))
            .count(),
        1
    );
    let records = apps_keys(&kernel)
        .into_keys()
        .filter(|k| k.starts_with("citadel_workspace.apps.install."))
        .count();
    assert_eq!(records, 1);
    let other_scope = install_request(
        &spec,
        &key,
        signed(&spec, &key, &bytes),
        InstallScope::Node("office".into()),
        CANVAS_NODES,
        false,
    );
    assert!(
        installed(&ask(&kernel, "inst", other_scope).await),
        "another scope is another install"
    );
}
