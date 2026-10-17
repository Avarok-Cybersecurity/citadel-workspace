//! Whether a session may be sent a broadcast: the decision the per-connection forwarding loop
//! makes for every broadcast it sees.
//!
//! The loop is the only place that knows which user a socket belongs to, so it is the only
//! place the check can be made; the decision lives here so the loop and the tests ask the same
//! function rather than each restating it.

use crate::handlers::domain::async_ops::AsyncPermissionOperations;
use crate::kernel::async_kernel::{AsyncWorkspaceServerKernel, BroadcastAudience};
use crate::kernel::group_access::authorize_group_read;
use citadel_sdk::prelude::Ratchet;
use citadel_workspace_types::structs::Permission;

impl<R: Ratchet + Send + Sync + 'static> AsyncWorkspaceServerKernel<R> {
    /// May `user_id`'s session receive a broadcast addressed to `audience`?
    pub async fn may_receive(&self, user_id: &str, audience: &BroadcastAudience) -> bool {
        match audience {
            BroadcastAudience::Everyone => true,
            // A group-scoped broadcast reaches only sessions entitled to that channel.
            BroadcastAudience::Group(group_id) => authorize_group_read(self, user_id, group_id)
                .await
                .is_some(),
            // A node-scoped broadcast reaches only sessions that may view that node. Same
            // reasoning as the group case above.
            BroadcastAudience::Node(node_id) => self.may_view(user_id, node_id).await,
            // A workspace-scoped broadcast reaches only that workspace's members. Same
            // reasoning as the node case above; the record carries the full member list, so
            // sending it to a non-member discloses the membership of a workspace they cannot
            // even read.
            BroadcastAudience::Workspace(workspace_id) => {
                self.may_view(user_id, workspace_id).await
            }
        }
    }

    async fn may_view(&self, user_id: &str, entity_id: &str) -> bool {
        self.domain_operations
            .check_entity_permission(user_id, entity_id, Permission::ViewContent)
            .await
            .unwrap_or(false)
    }
}
