//! # The workspace home keeps its own app tabs
//!
//! The home is the workspace root, which is never a stored node, so `UpdateNode` naming it answered
//! "Node not found" and "+" on the home could not add a tab. Its tabs are kept in the workspace
//! record under `app_tabs`, beside `default_app_tabs`, gated as a node's tabs are
//! (`UpdateNodeSettings`), and answered as the workspace record. A member who may configure only an
//! office cannot change them, and nothing but the tabs is changed on the home.

use citadel_workspace_server_kernel::kernel::async_kernel::AsyncWorkspaceServerKernel;
use citadel_workspace_server_kernel::kernel::command_processor::async_process_command::process_command_with_user;
use citadel_workspace_server_kernel::WORKSPACE_ROOT_ID;
use citadel_workspace_types::structs::{NodeEntityType, Permission};
use citadel_workspace_types::{
    UpdateOperation, WorkspaceProtocolRequest, WorkspaceProtocolResponse,
};
use common::async_test_helpers::execute_command;
use common::member_test_utils::create_test_user;
use common::roles_fixture::MEMBER_ROLE_ID;
use common::workspace_test_utils::{create_test_kernel, TEST_ADMIN_USER_ID};
use serde_json::{json, Value};

type Kernel = AsyncWorkspaceServerKernel<citadel_sdk::prelude::MonoRatchet>;

fn update(node_id: &str, name: Option<&str>, patch: Value) -> WorkspaceProtocolRequest {
    WorkspaceProtocolRequest::UpdateNode {
        node_id: node_id.to_string(),
        name: name.map(str::to_string),
        description: None,
        mdx_content: None,
        rules: None,
        chat_enabled: None,
        is_default: None,
        metadata: Some(serde_json::to_vec(&patch).unwrap()),
    }
}

async fn ask(
    kernel: &Kernel,
    user: &str,
    request: WorkspaceProtocolRequest,
) -> WorkspaceProtocolResponse {
    process_command_with_user(kernel, &request, user)
        .await
        .unwrap()
}

fn root_metadata(response: &WorkspaceProtocolResponse) -> Value {
    match response {
        WorkspaceProtocolResponse::Workspace(workspace) => {
            serde_json::from_slice(&workspace.metadata).unwrap()
        }
        other => panic!("expected the workspace record, got {other:?}"),
    }
}

/// An office whose member `user` holds `UpdateNodeSettings` there, and nowhere else.
async fn office_configurer(kernel: &Kernel, user: &str) -> String {
    let created = execute_command(
        kernel,
        WorkspaceProtocolRequest::CreateNode {
            parent_id: Some(WORKSPACE_ROOT_ID.to_string()),
            entity_type: NodeEntityType::Child("Office".to_string()),
            name: "Platform".to_string(),
            description: String::new(),
            metadata: None,
        },
    )
    .await
    .expect("CreateNode dispatch");
    let WorkspaceProtocolResponse::Node(office) = created else {
        panic!("expected Node, got {created:?}");
    };
    kernel
        .domain_operations
        .backend_tx_manager
        .insert_user(user.to_string(), create_test_user(user, MEMBER_ROLE_ID))
        .await
        .expect("insert user");
    for request in [
        WorkspaceProtocolRequest::AddMember {
            user_id: user.to_string(),
            domain_id: Some(office.id.clone()),
            role: MEMBER_ROLE_ID.to_string(),
            metadata: None,
        },
        WorkspaceProtocolRequest::UpdateMemberPermissions {
            user_id: user.to_string(),
            domain_id: office.id.clone(),
            permissions: vec![Permission::UpdateNodeSettings],
            operation: UpdateOperation::Set,
        },
    ] {
        execute_command(kernel, request).await.expect("dispatch");
    }
    office.id
}

#[tokio::test]
async fn the_home_sets_and_clears_its_own_tabs_beside_the_default() {
    let kernel = create_test_kernel().await;
    let tabs = json!({ "app_tabs": ["work.synchronized.app"] });
    let set = ask(
        &kernel,
        TEST_ADMIN_USER_ID,
        update(WORKSPACE_ROOT_ID, None, tabs),
    )
    .await;
    let metadata = root_metadata(&set);
    assert_eq!(metadata["app_tabs"], json!(["work.synchronized.app"]));
    assert!(
        metadata.get("default_app_tabs").is_some(),
        "the default is kept: {metadata}"
    );

    let cleared = ask(
        &kernel,
        TEST_ADMIN_USER_ID,
        update(WORKSPACE_ROOT_ID, None, json!({ "app_tabs": null })),
    )
    .await;
    assert!(root_metadata(&cleared).get("app_tabs").is_none());
}

#[tokio::test]
async fn the_home_tabs_need_update_node_settings_at_the_root() {
    let kernel = create_test_kernel().await;
    let office = office_configurer(&kernel, "member").await;
    let tabs = || json!({ "app_tabs": ["com.acme.kanban"] });

    let refused = ask(&kernel, "member", update(WORKSPACE_ROOT_ID, None, tabs())).await;
    assert!(
        matches!(refused, WorkspaceProtocolResponse::Error(ref e) if e.contains("UpdateNodeSettings")),
        "{refused:?}"
    );
    // Control: the same member may set the office's own tabs.
    let own = ask(&kernel, "member", update(&office, None, tabs())).await;
    assert!(matches!(own, WorkspaceProtocolResponse::Node(_)), "{own:?}");
}

#[tokio::test]
async fn nothing_but_the_tabs_is_changed_on_the_home() {
    let kernel = create_test_kernel().await;
    let tabs = || json!({ "app_tabs": ["com.acme.kanban"] });
    for request in [
        update(WORKSPACE_ROOT_ID, Some("Renamed"), tabs()),
        update(
            WORKSPACE_ROOT_ID,
            None,
            json!({ "app_tabs": [], "theme": "dark" }),
        ),
        update(
            WORKSPACE_ROOT_ID,
            None,
            json!({ "app_tabs": ["a.b.c", "a.b.c"] }),
        ),
    ] {
        let answer = ask(&kernel, TEST_ADMIN_USER_ID, request).await;
        assert!(
            matches!(answer, WorkspaceProtocolResponse::Error(_)),
            "{answer:?}"
        );
    }
}
