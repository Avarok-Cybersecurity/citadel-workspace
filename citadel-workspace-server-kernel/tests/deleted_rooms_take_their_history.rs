//! # A deleted room must not leave its messages on the server
//!
//! `delete_node` removed the node from the node map and saved. It never touched
//! `citadel_workspace.group_messages.<id>`, so every message anyone had ever
//! sent in that room stayed in the backend — unreachable, because the node that
//! named the key was gone, and therefore unlistable and unpurgeable too.
//!
//! For a product whose entire premise is that conversations are private, "we
//! kept everything you deleted, forever, where you cannot see it" is the wrong
//! behaviour twice over: it is not what the user was told, and it is not
//! reachable by any code path that could later correct it.
//!
//! ## The key these tests originally used was the wrong one
//!
//! History is stored under `citadel_workspace.group_messages.<group_id>`, and
//! `group_access` states what a group_id is: "a `group_id` is a node's
//! `chat_channel_id`". The purge passed the NODE ID, so it deleted a key that
//! had never existed and every deleted room's history survived untouched.
//!
//! These tests did not catch it because they seeded `chat_channel_id: None` and
//! stored their messages under the node id — matching the broken purge exactly.
//! Both passed against a purge that deleted nothing real. The fixture now mints
//! a channel id and stores history under it, which is what production does, and
//! the last test covers the node that has no channel at all.

use citadel_workspace_server_kernel::handlers::domain::node_ops::AsyncNodeOperations;
use citadel_workspace_server_kernel::WORKSPACE_ROOT_ID;
use citadel_workspace_types::structs::{DomainNode, DomainPermissions, NodeEntityType};
use common::workspace_test_utils::{create_test_kernel, TEST_ADMIN_USER_ID};
use std::collections::HashMap;

/// The channel a node's history is stored under. Distinct from the node id on
/// purpose: identical values would let a purge keyed on either one pass.
fn channel_of(node_id: &str) -> String {
    format!("chan-{node_id}")
}

fn mk_node(id: &str, parent: Option<&str>, children: Vec<String>, depth: u32) -> DomainNode {
    DomainNode {
        id: id.to_string(),
        parent_id: parent.map(|s| s.to_string()),
        entity_type: NodeEntityType::Child("Office".to_string()),
        depth,
        name: format!("node-{id}"),
        description: String::new(),
        owner_id: TEST_ADMIN_USER_ID.to_string(),
        members: vec![],
        children,
        mdx_content: String::new(),
        mdx_content_hash: None,
        rules: None,
        chat_enabled: true,
        chat_channel_id: Some(channel_of(id)),
        default_permissions: DomainPermissions::default(),
        metadata: vec![],
        allowed_child_types: None,
        is_default: false,
        created_at: 0,
        updated_at: 0,
    }
}

fn mk_message(id: &str, group_id: &str) -> citadel_workspace_types::GroupMessage {
    citadel_workspace_types::GroupMessage {
        id: id.to_string(),
        group_id: group_id.to_string(),
        sender_id: TEST_ADMIN_USER_ID.to_string(),
        sender_name: "admin".to_string(),
        message_type: citadel_workspace_types::GroupMessageType::Text,
        content: "something the sender expected to be able to delete".to_string(),
        timestamp: 1,
        reply_to: None,
        reply_count: 0,
        mentions: vec![],
        edited_at: None,
    }
}

#[tokio::test]
async fn deleting_a_room_deletes_the_messages_it_held() {
    let kernel = create_test_kernel().await;
    let backend = &kernel.domain_operations.backend_tx_manager;

    let mut nodes = HashMap::new();
    nodes.insert(
        "room-a".to_string(),
        mk_node("room-a", Some(WORKSPACE_ROOT_ID), vec![], 1),
    );
    nodes.insert(
        "room-b".to_string(),
        mk_node("room-b", Some(WORKSPACE_ROOT_ID), vec![], 1),
    );
    backend.save_nodes(&nodes).await.expect("seed nodes");

    backend
        .store_group_message(mk_message("m1", &channel_of("room-a")))
        .await
        .expect("store m1");
    backend
        .store_group_message(mk_message("m2", &channel_of("room-a")))
        .await
        .expect("store m2");
    backend
        .store_group_message(mk_message("m3", &channel_of("room-b")))
        .await
        .expect("store m3");

    // Precondition. Without it, a refactor that stopped storing messages would
    // make the assertion below pass by finding nothing to delete.
    assert_eq!(
        backend
            .get_group_messages(&channel_of("room-a"))
            .await
            .unwrap()
            .len(),
        2,
        "the room must actually have history before we delete it"
    );

    kernel
        .domain_operations
        .delete_node(TEST_ADMIN_USER_ID, "room-a", false)
        .await
        .expect("delete_node");

    assert!(
        backend
            .get_group_messages(&channel_of("room-a"))
            .await
            .unwrap()
            .is_empty(),
        "the deleted room's messages are still on the server"
    );
    assert_eq!(
        backend
            .get_group_messages(&channel_of("room-b"))
            .await
            .unwrap()
            .len(),
        1,
        "deleting one room must not reach another's history"
    );
}

/// Cascade deletes every descendant, so it has to take every descendant's
/// history too — the child rooms are exactly the ones with the conversations
/// in them, and they are removed without any per-node call of their own.
#[tokio::test]
async fn a_cascading_delete_takes_the_children_s_history_too() {
    let kernel = create_test_kernel().await;
    let backend = &kernel.domain_operations.backend_tx_manager;

    let mut nodes = HashMap::new();
    nodes.insert(
        "office".to_string(),
        mk_node(
            "office",
            Some(WORKSPACE_ROOT_ID),
            vec!["room".to_string()],
            1,
        ),
    );
    nodes.insert(
        "room".to_string(),
        mk_node("room", Some("office"), vec![], 2),
    );
    backend.save_nodes(&nodes).await.expect("seed nodes");

    backend
        .store_group_message(mk_message("m1", &channel_of("room")))
        .await
        .expect("store m1");

    kernel
        .domain_operations
        .delete_node(TEST_ADMIN_USER_ID, "office", true)
        .await
        .expect("cascading delete");

    assert!(
        backend
            .get_group_messages(&channel_of("room"))
            .await
            .unwrap()
            .is_empty(),
        "a cascaded child's messages outlived the room they were sent in"
    );
}

/// A purge keyed on the node id would delete nothing, and both tests above
/// would still have passed if their fixture had kept using node ids.
///
/// This states the discrimination directly: history stored under the node id is
/// NOT what production writes, and must survive — while the channel's history
/// goes. If someone re-keys the purge back to the node id, the assertions above
/// fail and this one turns green, which names the mistake exactly.
#[tokio::test]
async fn the_purge_is_keyed_on_the_channel_not_the_node() {
    let kernel = create_test_kernel().await;
    let backend = &kernel.domain_operations.backend_tx_manager;

    let mut nodes = HashMap::new();
    nodes.insert(
        "room-a".to_string(),
        mk_node("room-a", Some(WORKSPACE_ROOT_ID), vec![], 1),
    );
    backend.save_nodes(&nodes).await.expect("seed nodes");

    backend
        .store_group_message(mk_message("real", &channel_of("room-a")))
        .await
        .expect("store real");
    // A decoy under the node id. Nothing in production writes here.
    backend
        .store_group_message(mk_message("decoy", "room-a"))
        .await
        .expect("store decoy");

    kernel
        .domain_operations
        .delete_node(TEST_ADMIN_USER_ID, "room-a", false)
        .await
        .expect("delete_node");

    assert!(
        backend
            .get_group_messages(&channel_of("room-a"))
            .await
            .unwrap()
            .is_empty(),
        "the channel's history survived the room's deletion"
    );
    assert_eq!(
        backend.get_group_messages("room-a").await.unwrap().len(),
        1,
        "the purge reached a node-id-keyed record, which means it is keyed on \
         the node id again — the key production never writes to"
    );
}

/// A node with chat disabled has no channel and no history, and deleting it must
/// not error or reach anything.
#[tokio::test]
async fn a_room_without_a_chat_channel_deletes_cleanly() {
    let kernel = create_test_kernel().await;
    let backend = &kernel.domain_operations.backend_tx_manager;

    let mut node = mk_node("quiet", Some(WORKSPACE_ROOT_ID), vec![], 1);
    node.chat_channel_id = None;
    node.chat_enabled = false;
    let mut nodes = HashMap::new();
    nodes.insert("quiet".to_string(), node);
    backend.save_nodes(&nodes).await.expect("seed nodes");

    kernel
        .domain_operations
        .delete_node(TEST_ADMIN_USER_ID, "quiet", false)
        .await
        .expect("deleting a chatless node must succeed");
}
