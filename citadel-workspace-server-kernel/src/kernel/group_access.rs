//! Authorization for group (room/office) chat.
//!
//! A `group_id` is a node's `chat_channel_id` (`async_node_ops.rs:337`), minted
//! per node when chat is enabled. It is therefore scoped to exactly one node,
//! and the people entitled to it are the people entitled to view that node.
//!
//! The group-messaging handlers had no authorization of any kind: any
//! authenticated account could read, post into, edit and delete chat in any
//! room it had never been added to, purely by naming the channel id. The write
//! side of the tree has always been gated per node (`update_node` checks
//! `check_entity_permission` against the target), so this is the same rule the
//! rest of the tree already enforces, finally applied to chat.
//!
//! This module is the single place that decides it, so the request handlers and
//! the broadcast filter cannot drift apart.

use crate::handlers::domain::async_ops::AsyncPermissionOperations;
use crate::kernel::async_kernel::AsyncWorkspaceServerKernel;
use citadel_sdk::prelude::Ratchet;
use citadel_workspace_types::structs::Permission;

/// The message returned for every denial.
///
/// Deliberately identical whether the channel does not exist or the caller may
/// not see it: distinguishing them turns the handler into an oracle for which
/// rooms exist, which is precisely what a non-member must not learn.
pub const GROUP_ACCESS_DENIED: &str = "Permission denied: not a member of this chat channel";

/// Resolve the node owning `group_id` and answer whether `user_id` holds
/// `permission` on it.
///
/// Returns the owning node id on success so callers can log or scope further
/// work against it.
async fn authorize_group<R: Ratchet>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    user_id: &str,
    group_id: &str,
    permission: Permission,
) -> Option<String> {
    let node_id = resolve_group_node(kernel, group_id).await?;
    let allowed = kernel
        .domain_operations
        .check_entity_permission(user_id, &node_id, permission)
        .await
        .unwrap_or(false);
    allowed.then_some(node_id)
}

/// May this account SEE this channel's messages?
///
/// `ViewContent`, which is what a Guest holds. Reading is the whole of what a
/// Guest may do here.
pub async fn authorize_group_read<R: Ratchet>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    user_id: &str,
    group_id: &str,
) -> Option<String> {
    authorize_group(kernel, user_id, group_id, Permission::ViewContent).await
}

/// May this account WRITE to this channel — send, edit or delete?
///
/// `SendMessages`, not `ViewContent`. Every group-messaging handler asked the
/// read question, including the three that write, so a Guest — a role whose own
/// definition says "read-only access", and which is granted `ViewContent` and
/// nothing else — could post into, edit and delete chat in every room it could
/// see. `Member` is the lowest role that holds `SendMessages`.
///
/// Authorship is checked separately at the edit and delete handlers; this is the
/// permission to write at all, which is a different question from whose message
/// it is.
pub async fn authorize_group_write<R: Ratchet>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    user_id: &str,
    group_id: &str,
) -> Option<String> {
    authorize_group(kernel, user_id, group_id, Permission::SendMessages).await
}

/// The node whose `chat_channel_id` is `group_id`, if any.
///
/// An unknown channel is unowned, and an unowned channel is denied rather than
/// treated as public — otherwise deleting a node would silently re-open its
/// chat history to everyone.
pub async fn resolve_group_node<R: Ratchet>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    group_id: &str,
) -> Option<String> {
    // Shared, not cloned: this runs once per broadcast RECIPIENT, and twice more
    // inside the permission walk below it. See `nodes_cache`.
    let nodes = kernel
        .domain_operations
        .backend_tx_manager
        .get_all_nodes_shared()
        .await
        .ok()?;
    nodes
        .iter()
        .find(|(_, node)| node.chat_channel_id.as_deref() == Some(group_id))
        .map(|(id, _)| id.clone())
}
