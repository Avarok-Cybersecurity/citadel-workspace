//! # Async Node Operations Implementation
//!
//! This module implements AsyncNodeOperations for AsyncDomainServerOperations,
//! providing the generalized tree hierarchy node operations.
//!
//! Each operation lives in its own submodule as an inherent method; the
//! trait impl here only delegates to them.

mod create;
mod delete;
mod move_node;
mod read;
mod tree;
mod update;

use crate::handlers::domain::async_ops::AsyncPermissionOperations;
use crate::handlers::domain::node_ops::AsyncNodeOperations;
use crate::handlers::domain::server_ops::async_domain_server_ops::AsyncDomainServerOperations;
use crate::platform::{SystemTime, UNIX_EPOCH};
use async_trait::async_trait;
use citadel_sdk::prelude::{NetworkError, Ratchet};
use citadel_workspace_types::structs::{DomainNode, NodeEntityType, Permission, TreeNode};

/// Get current unix timestamp in seconds
fn current_timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

/// Refuse a workspace-content read to an account that may not view content.
///
/// The three node readers below each asked only `is_member_of_domain`, which for
/// a workspace id is literally `workspace.members.contains(user_id)` — role is
/// never consulted. Banning sets a ROLE and leaves the member list untouched, so
/// a banned account kept reading every office and room, `mdx_content` included,
/// plus the full roster, from the same tree `get_workspace` had just been taught
/// to withhold. That gate was added in one place and never propagated here.
///
/// Asked as `ViewContent` rather than `role != Banned` for the reason
/// `get_workspace` records: what `GetUserPermissions` reports must be what
/// enforcement allows. `for_role` gives Banned nothing and gives Guest
/// `ViewContent`, so this refuses exactly the accounts the permission editor
/// already shows as unable to view.
///
/// Scoped to the workspace root, matching the gate it propagates. Per-node read
/// authorization is a separate question this does not answer.
async fn ensure_may_view_workspace<R: Ratchet + Send + Sync + 'static>(
    ops: &AsyncDomainServerOperations<R>,
    user_id: &str,
) -> Result<(), NetworkError> {
    if !ops
        .is_member_of_domain(user_id, crate::WORKSPACE_ROOT_ID)
        .await?
    {
        return Err(NetworkError::msg(
            "Permission denied: Not a member of this workspace",
        ));
    }
    if !ops
        .check_entity_permission(user_id, crate::WORKSPACE_ROOT_ID, Permission::ViewContent)
        .await?
    {
        return Err(NetworkError::msg(
            "Permission denied: ViewContent is required to read this workspace",
        ));
    }
    Ok(())
}

#[async_trait]
impl<R: Ratchet + Send + Sync + 'static> AsyncNodeOperations<R> for AsyncDomainServerOperations<R> {
    async fn create_node(
        &self,
        user_id: &str,
        parent_id: Option<&str>,
        entity_type: &NodeEntityType,
        name: &str,
        description: &str,
        metadata: Option<&[u8]>,
    ) -> Result<DomainNode, NetworkError> {
        self.create_node_impl(user_id, parent_id, entity_type, name, description, metadata)
            .await
    }

    async fn get_node(&self, user_id: &str, node_id: &str) -> Result<DomainNode, NetworkError> {
        self.get_node_impl(user_id, node_id).await
    }

    async fn update_node(
        &self,
        user_id: &str,
        node_id: &str,
        name: Option<&str>,
        description: Option<&str>,
        mdx_content: Option<&str>,
        rules: Option<&str>,
        chat_enabled: Option<bool>,
        is_default: Option<bool>,
    ) -> Result<DomainNode, NetworkError> {
        self.update_node_impl(
            user_id,
            node_id,
            name,
            description,
            mdx_content,
            rules,
            chat_enabled,
            is_default,
        )
        .await
    }

    async fn delete_node(
        &self,
        user_id: &str,
        node_id: &str,
        cascade: bool,
    ) -> Result<Vec<String>, NetworkError> {
        self.delete_node_impl(user_id, node_id, cascade).await
    }

    async fn move_node(
        &self,
        user_id: &str,
        node_id: &str,
        new_parent_id: Option<&str>,
    ) -> Result<DomainNode, NetworkError> {
        self.move_node_impl(user_id, node_id, new_parent_id).await
    }

    async fn list_nodes(
        &self,
        user_id: &str,
        parent_id: Option<&str>,
        depth: Option<u32>,
        entity_types: Option<&[NodeEntityType]>,
    ) -> Result<Vec<DomainNode>, NetworkError> {
        self.list_nodes_impl(user_id, parent_id, depth, entity_types)
            .await
    }

    async fn get_tree_structure(
        &self,
        user_id: &str,
        root_id: Option<&str>,
        max_depth: Option<u32>,
    ) -> Result<TreeNode, NetworkError> {
        self.get_tree_structure_impl(user_id, root_id, max_depth)
            .await
    }
}
