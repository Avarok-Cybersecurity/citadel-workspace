//! The required-apps header through the kernel: written on an `AppManage` install, removed on
//! uninstall, and kept by every edit of someone without `AppManage`.

use super::md_header::HEADER_MANAGED;
use super::test_manifests::*;
use super::test_support::{ask, Kernel};
use crate::kernel::command_processor::async_process_command::process_command_with_user;
use citadel_workspace_types::apps::{Capability, InstallScope};
use citadel_workspace_types::apps_install::{AppInstall, AppsRefusal};
use citadel_workspace_types::apps_protocol::AppsRequest;
use citadel_workspace_types::apps_responses::AppsResponse;
use citadel_workspace_types::structs::{mdx_content_hash, Permission};
use citadel_workspace_types::{WorkspaceProtocolRequest, WorkspaceProtocolResponse};

const HEADER: &str = r#"{/* @citadel-apps 1 {"require":[{"app":"com.acme.kanban","min":"1.0.0","surface":"none"}]} */}"#;
const CAPS: &[Capability] = &[Capability::Canvas, Capability::NodesRead];

async fn content(kernel: &Kernel, node: &str) -> String {
    let backend = &kernel.domain_operations.backend_tx_manager;
    let node = backend.get_node(node).await.unwrap().unwrap();
    assert_eq!(
        node.mdx_content_hash,
        Some(mdx_content_hash(&node.mdx_content))
    );
    node.mdx_content
}

async fn install_into(kernel: &Kernel, who: &str, node: &str) -> AppsResponse {
    let (key, bytes, spec) = (publisher(1), wasm(1, 4096), Spec::new("1.0.0"));
    let scope = InstallScope::NodeTree(node.into());
    ask(
        kernel,
        who,
        install_request(&spec, &key, signed(&spec, &key, &bytes), scope, CAPS, true),
    )
    .await
}

async fn injected(kernel: &Kernel) -> AppInstall {
    match install_into(kernel, "mgr", "office").await {
        AppsResponse::Installed { install } => install,
        other => panic!("{other:?}"),
    }
}

async fn edit(kernel: &Kernel, who: &str, node: &str, mdx: String) -> WorkspaceProtocolResponse {
    let request = WorkspaceProtocolRequest::UpdateNode {
        node_id: node.into(),
        name: None,
        description: None,
        mdx_content: Some(mdx),
        rules: None,
        chat_enabled: None,
        is_default: None,
    };
    process_command_with_user(kernel, &request, who)
        .await
        .unwrap()
}

fn refused_as_managed(answer: &WorkspaceProtocolResponse) -> bool {
    matches!(answer, WorkspaceProtocolResponse::Error(text) if text.contains(HEADER_MANAGED))
}

#[tokio::test]
async fn an_app_manage_install_writes_the_header_and_its_uninstall_removes_it() {
    let kernel = workspace_serving(wasm(1, 4096)).await;
    let install = injected(&kernel).await;
    assert_eq!(install.injected_header_into, vec!["office".to_string()]);
    assert_eq!(
        content(&kernel, "office").await,
        format!("{HEADER}\n# Body\n")
    );
    assert_eq!(
        content(&kernel, "room").await,
        "# Body\n",
        "the tree's root only"
    );
    let uninstall = AppsRequest::Uninstall {
        install_id: install.id,
        purge_storage: true,
    };
    assert!(matches!(
        ask(&kernel, "mgr", uninstall).await,
        AppsResponse::Uninstalled { .. }
    ));
    assert_eq!(content(&kernel, "office").await, "# Body\n");
}

#[tokio::test]
async fn writing_the_header_takes_app_manage() {
    let kernel = workspace_serving(wasm(1, 4096)).await;
    assert_eq!(
        install_into(&kernel, "inst", "office").await,
        AppsResponse::Refused(AppsRefusal::PermissionRequired(Permission::AppManage))
    );
    assert_eq!(content(&kernel, "office").await, "# Body\n");
}

#[tokio::test]
async fn an_editor_keeps_the_header_and_may_change_everything_below_it() {
    let kernel = workspace_serving(wasm(1, 4096)).await;
    injected(&kernel).await;
    let revised = format!("{HEADER}\n# Body, revised\n");
    let answer = edit(&kernel, "ed", "office", revised.clone()).await;
    assert!(
        matches!(answer, WorkspaceProtocolResponse::Node(_)),
        "{answer:?}"
    );
    assert_eq!(content(&kernel, "office").await, revised);
    let dropped = edit(&kernel, "ed", "office", "# Body, revised\n".to_string()).await;
    assert!(refused_as_managed(&dropped), "{dropped:?}");
    let added = edit(&kernel, "ed", "room", format!("{HEADER}\n# Body\n")).await;
    assert!(refused_as_managed(&added), "{added:?}");
    assert_eq!(content(&kernel, "office").await, revised);
    assert_eq!(content(&kernel, "room").await, "# Body\n");
}

#[tokio::test]
async fn an_app_manage_holder_may_change_the_header() {
    let kernel = workspace_serving(wasm(1, 4096)).await;
    injected(&kernel).await;
    let answer = edit(&kernel, "mgr", "office", "# Body\n".to_string()).await;
    assert!(
        matches!(answer, WorkspaceProtocolResponse::Node(_)),
        "{answer:?}"
    );
    assert_eq!(content(&kernel, "office").await, "# Body\n");
}
