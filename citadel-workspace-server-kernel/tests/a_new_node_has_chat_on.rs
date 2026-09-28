//! A newly created office or room has its chat switched on, with a channel to talk in.
//!
//! Live (owner, 2026-09-27): "chat is not on by default for offices/rooms". `create_node`
//! hard-coded `chat_enabled: false` with no channel, so every new office opened without a Chat
//! tab until an admin found the switch. Enabling chat and minting its channel is one rule, shared
//! with `update_node`, so the two paths cannot disagree about what "chat on" means.
//!
//! No mocks: the real kernel's domain operations, and the node read back from storage.
use citadel_workspace_server_kernel::handlers::domain::node_ops::AsyncNodeOperations;
use citadel_workspace_types::structs::{DomainNode, NodeEntityType};
use common::workspace_test_utils::{create_test_kernel, TEST_ADMIN_USER_ID};

const ROOT: &str = citadel_workspace_server_kernel::WORKSPACE_ROOT_ID;

fn assert_chat_on(node: &DomainNode, what: &str) {
    assert!(node.chat_enabled, "a new {what} opened with chat off");
    assert!(
        node.chat_channel_id
            .as_deref()
            .is_some_and(|c| !c.is_empty()),
        "a new {what} has chat on but no channel to talk in"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_new_office_and_room_have_chat_on_with_their_own_channels() {
    let kernel = create_test_kernel().await;
    let ops = &kernel.domain_operations;

    let office: DomainNode = ops
        .create_node(
            TEST_ADMIN_USER_ID,
            Some(ROOT),
            &NodeEntityType::Child("Office".to_string()),
            "Ops",
            "",
        )
        .await
        .expect("an admin may create an office");
    assert_chat_on(&office, "office");

    let room: DomainNode = ops
        .create_node(
            TEST_ADMIN_USER_ID,
            Some(&office.id),
            &NodeEntityType::Child("Room".to_string()),
            "Standup",
            "",
        )
        .await
        .expect("an admin may create a room");
    assert_chat_on(&room, "room");
    assert_ne!(
        office.chat_channel_id, room.chat_channel_id,
        "two nodes share one chat channel"
    );

    // What the creator is told is what was stored.
    let stored: DomainNode = ops
        .get_node(TEST_ADMIN_USER_ID, &room.id)
        .await
        .expect("the room reads back");
    assert_chat_on(&stored, "room, read back");
    assert_eq!(stored.chat_channel_id, room.chat_channel_id);
}
