//! # A failed history purge must leave `delete_node` retryable
//!
//! `delete_node` used to save the pruned tree FIRST and purge the deleted
//! rooms' chat history after, with a comment claiming a failed purge was
//! "recoverable by deleting again". It was not: the save had already removed
//! the node, so a retry hit `validate_delete`'s NodeNotFound — and with the
//! node gone, nothing knew the channel key any more. The handler returned Err
//! for a deletion that had persisted (a false failure), and the surviving
//! messages were orphaned in the backend forever.
//!
//! These tests stage the purge failure with the transaction manager's
//! test-only delete-fault hook — the in-memory backend cannot otherwise fail
//! a delete — and assert the ordering that makes the failure recoverable:
//! the tree write must not happen until every purge has succeeded.
//!
//! This is a unit test rather than an integration test deliberately: the
//! `#[cfg(test)]` fault hook does not exist in the build the `tests/` crates
//! link against.

use crate::handlers::domain::node_ops::AsyncNodeOperations;
use crate::handlers::domain::server_ops::async_domain_server_ops::AsyncDomainServerOperations;
use crate::kernel::transaction::BackendTransactionManager;
use citadel_sdk::prelude::StackedRatchet;
use citadel_workspace_types::structs::{
    DomainNode, DomainPermissions, NodeEntityType, User, UserRole,
};
use citadel_workspace_types::{GroupMessage, GroupMessageType};
use std::collections::HashMap;
use std::sync::Arc;

fn admin() -> User {
    User {
        id: "admin".to_string(),
        name: "Admin".to_string(),
        role: UserRole::Admin,
        permissions: HashMap::new(),
        metadata: HashMap::new(),
    }
}

fn room(id: &str, channel: &str) -> DomainNode {
    DomainNode {
        id: id.to_string(),
        parent_id: Some(crate::WORKSPACE_ROOT_ID.to_string()),
        entity_type: NodeEntityType::Child("Room".to_string()),
        depth: 1,
        name: format!("room-{id}"),
        description: String::new(),
        owner_id: "admin".to_string(),
        members: vec![],
        children: vec![],
        mdx_content: String::new(),
        mdx_content_hash: None,
        rules: None,
        chat_enabled: true,
        chat_channel_id: Some(channel.to_string()),
        default_permissions: DomainPermissions::default(),
        metadata: vec![],
        allowed_child_types: None,
        is_default: false,
        created_at: 0,
        updated_at: 0,
    }
}

fn msg(id: &str, group_id: &str) -> GroupMessage {
    GroupMessage {
        id: id.to_string(),
        group_id: group_id.to_string(),
        sender_id: "admin".to_string(),
        sender_name: "Admin".to_string(),
        message_type: GroupMessageType::Text,
        content: format!("body-{id}"),
        timestamp: 0,
        reply_to: None,
        reply_count: 0,
        mentions: vec![],
        edited_at: None,
    }
}

#[tokio::test]
async fn a_failed_history_purge_leaves_the_delete_retryable() {
    let mgr = Arc::new(BackendTransactionManager::<StackedRatchet>::new());
    let ops = AsyncDomainServerOperations {
        backend_tx_manager: mgr.clone(),
    };

    mgr.insert_user("admin".to_string(), admin())
        .await
        .expect("seed admin");
    let mut nodes = HashMap::new();
    nodes.insert("room1".to_string(), room("room1", "chan-1"));
    mgr.save_nodes(&nodes).await.expect("seed node");
    mgr.store_group_message(msg("m1", "chan-1"))
        .await
        .expect("seed message");

    // The key that actually holds the history now that rooms are paged.
    //
    // `citadel_workspace.group_messages.chan-1` is the pre-paging blob, and the
    // first write migrates it away — so faulting it would fault a key holding
    // nothing, and the purge would succeed at removing every message before
    // failing on an empty legacy delete. The assertion below would then be
    // measuring a purge that HAD happened.
    //
    // Faulting the page is also what makes the original property still true:
    // `delete_all_group_messages` removes the pages first and the index last, so
    // a failure among the pages leaves the index pointing at everything that is
    // still there. Nothing is orphaned and the history is still readable, which
    // is exactly what this test asserted before paging existed.
    let channel_key = "citadel_workspace.group_messages.chan-1.page.0";
    mgr.fail_deletes_of(channel_key);

    let _ = ops
        .delete_node("admin", "room1", false)
        .await
        .expect_err("the purge failure must surface");

    // The discriminating assertion: the tree write must NOT have happened.
    // With the old ordering the node was already saved away, so the Err was a
    // false failure and this retry path did not exist.
    assert!(
        mgr.get_all_nodes()
            .await
            .expect("read nodes")
            .contains_key("room1"),
        "an Err from delete_node must mean the node still exists, \
         or 'deleting again' hits NodeNotFound and the history is orphaned forever"
    );
    assert_eq!(
        mgr.get_group_messages("chan-1")
            .await
            .expect("read messages")
            .len(),
        1,
        "the failed purge left the history untouched"
    );

    // Deleting again must genuinely recover once the failure clears.
    mgr.clear_delete_fault(channel_key);
    let deleted = ops
        .delete_node("admin", "room1", false)
        .await
        .expect("deleting again recovers");
    assert_eq!(deleted, vec!["room1".to_string()]);
    assert!(!mgr
        .get_all_nodes()
        .await
        .expect("read nodes")
        .contains_key("room1"));
    assert!(
        mgr.get_group_messages("chan-1")
            .await
            .expect("read messages")
            .is_empty(),
        "the retry purged the history the first attempt could not"
    );
}
