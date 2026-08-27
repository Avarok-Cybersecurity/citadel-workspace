//! Everyone must learn when the tree changes, not just whoever changed it.
//!
//! Only `NodeContentUpdated` was ever broadcast. `CreateNode`, `DeleteNode`,
//! `MoveNode` and renames answered the requester and stopped there — and the
//! client calls `listNodes` exactly once, at login, with no polling and no
//! reload event. So one user's new room stayed invisible to everyone else until
//! they signed in again; a deleted office stayed in their sidebar, where they
//! kept opening it and typing into its chat; and a rename showed the old name
//! indefinitely.
//!
//! The client handlers for all three variants already existed. They simply never
//! fired for anyone but the requester, which is why nothing looked broken from
//! the seat that made the change — the only seat anyone tests from.

use citadel_workspace_server_kernel::kernel::command_processor::async_process_command::process_command_with_user;
use citadel_workspace_server_kernel::WORKSPACE_ROOT_ID;
use citadel_workspace_types::structs::NodeEntityType;
use citadel_workspace_types::{WorkspaceProtocolRequest, WorkspaceProtocolResponse};
use common::workspace_test_utils::{create_test_kernel, TEST_ADMIN_USER_ID};
use std::time::Duration;

/// Drains the broadcast channel for a short while, collecting what arrives.
async fn drain(
    rx: &mut tokio::sync::broadcast::Receiver<
        citadel_workspace_server_kernel::kernel::async_kernel::BroadcastMessage,
    >,
) -> Vec<WorkspaceProtocolResponse> {
    let mut seen = Vec::new();
    while let Ok(Ok(msg)) = tokio::time::timeout(Duration::from_millis(200), rx.recv()).await {
        seen.push(msg.response);
    }
    seen
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn creating_a_node_is_broadcast_to_everyone_else() {
    let kernel = create_test_kernel().await;
    let mut rx = kernel.subscribe_broadcast();

    let response = process_command_with_user(
        &kernel,
        &WorkspaceProtocolRequest::CreateNode {
            parent_id: Some(WORKSPACE_ROOT_ID.to_string()),
            entity_type: NodeEntityType::Child("Office".to_string()),
            name: "Engineering".to_string(),
            description: String::new(),
        },
        TEST_ADMIN_USER_ID,
    )
    .await
    .expect("CreateNode dispatch failed");

    assert!(
        matches!(response, WorkspaceProtocolResponse::Node(_)),
        "the requester still gets their direct answer; got {response:?}"
    );

    let broadcast = drain(&mut rx).await;
    assert!(
        broadcast
            .iter()
            .any(|r| matches!(r, WorkspaceProtocolResponse::Node(n) if n.name == "Engineering")),
        "a created node must reach every other member; without this it is \
         invisible to them until they sign in again"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn deleting_a_node_is_broadcast_to_everyone_else() {
    let kernel = create_test_kernel().await;

    let created = process_command_with_user(
        &kernel,
        &WorkspaceProtocolRequest::CreateNode {
            parent_id: Some(WORKSPACE_ROOT_ID.to_string()),
            entity_type: NodeEntityType::Child("Office".to_string()),
            name: "Doomed".to_string(),
            description: String::new(),
        },
        TEST_ADMIN_USER_ID,
    )
    .await
    .expect("CreateNode dispatch failed");
    let node_id = match created {
        WorkspaceProtocolResponse::Node(n) => n.id,
        other => panic!("expected a Node response, got {other:?}"),
    };

    // Subscribed AFTER the create, so only the delete can satisfy the assertion.
    let mut rx = kernel.subscribe_broadcast();

    process_command_with_user(
        &kernel,
        &WorkspaceProtocolRequest::DeleteNode {
            node_id: node_id.clone(),
            cascade: true,
        },
        TEST_ADMIN_USER_ID,
    )
    .await
    .expect("DeleteNode dispatch failed");

    let broadcast = drain(&mut rx).await;
    assert!(
        broadcast.iter().any(
            |r| matches!(r, WorkspaceProtocolResponse::NodeDeleted { node_id: id, .. } if *id == node_id)
        ),
        "a deleted node must reach every other member; without this it stays in \
         their sidebar and they keep opening it"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn renaming_a_node_is_broadcast_to_everyone_else() {
    let kernel = create_test_kernel().await;

    let created = process_command_with_user(
        &kernel,
        &WorkspaceProtocolRequest::CreateNode {
            parent_id: Some(WORKSPACE_ROOT_ID.to_string()),
            entity_type: NodeEntityType::Child("Office".to_string()),
            name: "Old Name".to_string(),
            description: String::new(),
        },
        TEST_ADMIN_USER_ID,
    )
    .await
    .expect("CreateNode dispatch failed");
    let node_id = match created {
        WorkspaceProtocolResponse::Node(n) => n.id,
        other => panic!("expected a Node response, got {other:?}"),
    };

    let mut rx = kernel.subscribe_broadcast();

    process_command_with_user(
        &kernel,
        &WorkspaceProtocolRequest::UpdateNode {
            node_id: node_id.clone(),
            name: Some("New Name".to_string()),
            description: None,
            mdx_content: None,
            rules: None,
            chat_enabled: None,
        },
        TEST_ADMIN_USER_ID,
    )
    .await
    .expect("UpdateNode dispatch failed");

    let broadcast = drain(&mut rx).await;
    assert!(
        broadcast
            .iter()
            .any(|r| matches!(r, WorkspaceProtocolResponse::Node(n) if n.name == "New Name")),
        "a rename is not a content update, so NodeContentUpdated does not cover \
         it — other users kept showing the old name"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_pure_content_save_does_not_also_broadcast_a_structural_update() {
    let kernel = create_test_kernel().await;

    let created = process_command_with_user(
        &kernel,
        &WorkspaceProtocolRequest::CreateNode {
            parent_id: Some(WORKSPACE_ROOT_ID.to_string()),
            entity_type: NodeEntityType::Child("Office".to_string()),
            name: "Docs".to_string(),
            description: String::new(),
        },
        TEST_ADMIN_USER_ID,
    )
    .await
    .expect("CreateNode dispatch failed");
    let node_id = match created {
        WorkspaceProtocolResponse::Node(n) => n.id,
        other => panic!("expected a Node response, got {other:?}"),
    };

    let mut rx = kernel.subscribe_broadcast();

    process_command_with_user(
        &kernel,
        &WorkspaceProtocolRequest::UpdateNode {
            node_id,
            name: None,
            description: None,
            mdx_content: Some("# hello".to_string()),
            rules: None,
            chat_enabled: None,
        },
        TEST_ADMIN_USER_ID,
    )
    .await
    .expect("UpdateNode dispatch failed");

    let broadcast = drain(&mut rx).await;
    // The content broadcast already exists and carries the text; adding a
    // structural Node broadcast on top would make every keystroke-save rewrite
    // the receiver's whole node entry, clobbering anything they had locally.
    assert!(
        broadcast
            .iter()
            .any(|r| matches!(r, WorkspaceProtocolResponse::NodeContentUpdated { .. })),
        "a content save must still broadcast the content"
    );
    assert!(
        !broadcast
            .iter()
            .any(|r| matches!(r, WorkspaceProtocolResponse::Node(_))),
        "a pure content save is not a structural change"
    );
}
