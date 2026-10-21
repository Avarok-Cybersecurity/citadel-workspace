//! What an install may do follows its installer's role at the time of the call.

use super::test_manifests::*;
use super::test_support::ask;
use crate::kernel::command_processor::apps_gather::effective_for;
use crate::WORKSPACE_ROOT_ID;
use citadel_workspace_types::apps::{Capability, InstallScope};
use citadel_workspace_types::apps_responses::AppsResponse;
use citadel_workspace_types::structs::Permission;

#[tokio::test]
async fn demoting_the_installer_shrinks_what_the_install_may_do_at_the_next_call() {
    let (key, bytes, spec) = (publisher(1), wasm(1, 4096), Spec::new("1.0.0"));
    let kernel = workspace_serving(bytes.clone()).await;
    let caps = [Capability::Canvas, Capability::NodesRead];
    let request = install_request(
        &spec,
        &key,
        signed(&spec, &key, &bytes),
        InstallScope::Workspace,
        &caps,
        false,
    );
    let AppsResponse::Installed { install } = ask(&kernel, "inst", request).await else {
        panic!()
    };
    let now = effective_for(&kernel, &install, "alice", "office")
        .await
        .unwrap();
    assert_eq!(now, caps.into_iter().collect());

    let backend = &kernel.domain_operations.backend_tx_manager;
    let mut roles = backend.get_roles(WORKSPACE_ROOT_ID).await.unwrap();
    for role in roles.roles.iter_mut().filter(|r| r.id == "installer") {
        role.permissions
            .remove(&Permission::AppInstallAllowNodeRead);
    }
    backend.save_roles(WORKSPACE_ROOT_ID, &roles).await.unwrap();
    let after = effective_for(&kernel, &install, "alice", "office")
        .await
        .unwrap();
    assert_eq!(after, [Capability::Canvas].into_iter().collect());
    let unreached = effective_for(&kernel, &install, "nobody", "office")
        .await
        .unwrap();
    assert!(unreached.is_empty(), "an install reaches members only");
}
