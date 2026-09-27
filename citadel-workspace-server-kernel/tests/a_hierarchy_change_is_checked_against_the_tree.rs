//! A hierarchy change is saved only when it is sound, allowed, and leaves every existing office and
//! room somewhere it is allowed to be.
//!
//! The hierarchy editor sends UpdateTreeSchema. It was gated on is_admin rather than the permission
//! the schema names (ManageNodeTypes), saved anything, told nobody, and left every stored node
//! advertising the child levels of the schema it was created under.
//!
//! No mocks: the real command processor, storage and broadcast channel.
use citadel_workspace_server_kernel::kernel::command_processor::async_process_command::process_command_with_user;
use citadel_workspace_server_kernel::WORKSPACE_ROOT_ID;
use citadel_workspace_types::structs::{
    EntityTypeConfig, NestingRule, NodeEntityType, TreeSchema, UserRole,
};
use citadel_workspace_types::{WorkspaceProtocolRequest, WorkspaceProtocolResponse};
use common::member_test_utils::{insert_user_with_role, join_root, GateKernel as Kernel};
use common::workspace_test_utils::{create_test_kernel, TEST_ADMIN_USER_ID};
use std::time::Duration;

async fn send(
    kernel: &Kernel,
    request: WorkspaceProtocolRequest,
    user: &str,
) -> WorkspaceProtocolResponse {
    process_command_with_user(kernel, &request, user)
        .await
        .expect("dispatch failed")
}

async fn stored_schema(kernel: &Kernel) -> TreeSchema {
    kernel
        .domain_operations
        .backend_tx_manager
        .get_tree_schema_or_default()
        .await
        .expect("schema read failed")
}

fn level(name: &str) -> EntityTypeConfig {
    EntityTypeConfig {
        type_name: name.to_string(),
        icon: "folder".to_string(),
        label: name.to_string(),
        plural_label: format!("{name}s"),
        name_placeholder: String::new(),
        description_placeholder: String::new(),
        chat_default: true,
    }
}

/// The default schema with `edit` applied to its rules.
fn default_with(edit: impl FnOnce(&mut Vec<NestingRule>)) -> TreeSchema {
    let mut schema = TreeSchema::default();
    edit(&mut schema.rules);
    schema
}

async fn create(kernel: &Kernel, parent: &str, kind: &str, name: &str) -> String {
    match send(
        kernel,
        WorkspaceProtocolRequest::CreateNode {
            parent_id: Some(parent.to_string()),
            entity_type: NodeEntityType::Child(kind.to_string()),
            name: name.to_string(),
            description: String::new(),
        },
        TEST_ADMIN_USER_ID,
    )
    .await
    {
        WorkspaceProtocolResponse::Node(n) => n.id,
        other => panic!("create {kind} failed: {other:?}"),
    }
}

fn error_of(response: WorkspaceProtocolResponse) -> String {
    match response {
        WorkspaceProtocolResponse::Error(e) => e,
        other => panic!("expected a refusal, got {other:?}"),
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_member_without_manage_node_types_is_refused() {
    let kernel = create_test_kernel().await;
    insert_user_with_role(&kernel, "mia", UserRole::Member).await;
    join_root(&kernel, "mia").await;
    let request = WorkspaceProtocolRequest::UpdateTreeSchema {
        schema: TreeSchema::default(),
    };
    assert!(error_of(send(&kernel, request, "mia").await).contains("ManageNodeTypes"));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_deeper_hierarchy_is_saved_with_its_depth_and_reaches_the_members() {
    let kernel = create_test_kernel().await;
    let mut rx = kernel.subscribe_broadcast();
    let mut schema = TreeSchema::default();
    schema.rules.push(NestingRule {
        parent_type: "Room".to_string(),
        allowed_child_types: vec!["Desk".to_string()],
    });
    schema.entity_type_configs.push(level("Desk"));
    schema.max_depth = Some(1); // a client's value is not trusted

    let response = send(
        &kernel,
        WorkspaceProtocolRequest::UpdateTreeSchema { schema },
        TEST_ADMIN_USER_ID,
    )
    .await;
    assert!(
        matches!(&response, WorkspaceProtocolResponse::TreeSchema(s) if s.max_depth == Some(3)),
        "Workspace → Office → Room → Desk is depth 3; got {response:?}"
    );
    assert_eq!(stored_schema(&kernel).await.max_depth, Some(3));

    let mut heard = false;
    while let Ok(Ok(msg)) = tokio::time::timeout(Duration::from_millis(200), rx.recv()).await {
        heard |= matches!(msg.response, WorkspaceProtocolResponse::TreeSchema(_));
    }
    assert!(
        heard,
        "a hierarchy change reaching only its author leaves every other sidebar on the old labels"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_change_that_would_strand_an_existing_room_is_refused_and_names_it() {
    let kernel = create_test_kernel().await;
    let office = create(&kernel, WORKSPACE_ROOT_ID, "Office", "Ops").await;
    create(&kernel, &office, "Room", "Standup").await;

    let no_rooms_in_offices = default_with(|rules| {
        rules
            .iter_mut()
            .find(|r| r.parent_type == "Office")
            .unwrap()
            .allowed_child_types
            .clear();
    });
    let reason = error_of(
        send(
            &kernel,
            WorkspaceProtocolRequest::UpdateTreeSchema {
                schema: no_rooms_in_offices,
            },
            TEST_ADMIN_USER_ID,
        )
        .await,
    );
    assert!(reason.contains("\"Standup\""), "{reason}");
    assert!(
        stored_schema(&kernel)
            .await
            .is_child_allowed("Office", "Room"),
        "the refused schema was saved"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_unsound_schema_is_refused_with_its_reason_and_not_saved() {
    let kernel = create_test_kernel().await;
    let reason = error_of(
        send(
            &kernel,
            WorkspaceProtocolRequest::UpdateTreeSchema {
                schema: default_with(|r| r.clear()),
            },
            TEST_ADMIN_USER_ID,
        )
        .await,
    );
    assert!(reason.contains("Workspace"), "{reason}");
    assert!(!stored_schema(&kernel).await.rules.is_empty());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_node_is_sent_with_the_child_levels_the_current_schema_allows() {
    let kernel = create_test_kernel().await;
    let office = create(&kernel, WORKSPACE_ROOT_ID, "Office", "Ops").await;

    let mut schema = default_with(|rules| {
        rules
            .iter_mut()
            .find(|r| r.parent_type == "Office")
            .unwrap()
            .allowed_child_types
            .push("Desk".into());
    });
    schema.entity_type_configs.push(level("Desk"));
    assert!(matches!(
        send(
            &kernel,
            WorkspaceProtocolRequest::UpdateTreeSchema { schema },
            TEST_ADMIN_USER_ID
        )
        .await,
        WorkspaceProtocolResponse::TreeSchema(_)
    ));

    match send(
        &kernel,
        WorkspaceProtocolRequest::GetNode { node_id: office },
        TEST_ADMIN_USER_ID,
    )
    .await
    {
        WorkspaceProtocolResponse::Node(n) => assert_eq!(
            n.allowed_child_types,
            Some(vec!["Room".to_string(), "Desk".to_string()]),
            "the office still advertises the child levels it was created with"
        ),
        other => panic!("GetNode failed: {other:?}"),
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_level_created_by_name_gets_a_label() {
    let kernel = create_test_kernel().await;
    let response = send(
        &kernel,
        WorkspaceProtocolRequest::CreateNodeType {
            name: "Desk".to_string(),
            display_name: "Desk".to_string(),
            icon: None,
            allowed_parents: vec!["Room".to_string()],
        },
        TEST_ADMIN_USER_ID,
    )
    .await;
    assert!(
        matches!(response, WorkspaceProtocolResponse::NodeTypes(_)),
        "{response:?}"
    );
    let schema = stored_schema(&kernel).await;
    let config = schema
        .entity_type_configs
        .iter()
        .find(|c| c.type_name == "Desk")
        .expect("Desk has no label");
    assert_eq!(
        (config.label.as_str(), config.icon.as_str()),
        ("Desk", "folder")
    );
    assert_eq!(schema.max_depth, Some(3));
}
