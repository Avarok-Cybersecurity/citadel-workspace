//! The two ways past a direct grant into an entity: the member's role in its workspace, and, for
//! viewing only, being a booking guest of it or of a level above it (Calendar design §3.6.4).
//!
//! A guest's access is read from the live link records on every check, so it ends the moment the
//! link expires or is deleted: nothing was written to the account that could outlive the link.

use super::async_domain_server_ops::AsyncDomainServerOperations;
use crate::handlers::domain::async_ops::AsyncPermissionOperations;
use crate::kernel::secure_links::guests::covers;
use crate::platform::{SystemTime, UNIX_EPOCH};
use citadel_sdk::prelude::{NetworkError, Ratchet};
use citadel_workspace_types::structs::{DomainNode, Permission, User};
use std::collections::{BTreeSet, HashMap};

impl<R: Ratchet + Send + Sync + 'static> AsyncDomainServerOperations<R> {
    /// Membership of `entity_id` confers the permissions of the user's role in the workspace it
    /// belongs to: scoped to membership of this domain, and to that workspace's table.
    pub(crate) async fn role_grants_here(
        &self,
        user_id: &str,
        user: &User,
        entity_id: &str,
        nodes: &HashMap<String, DomainNode>,
        permission: Permission,
    ) -> Result<bool, NetworkError> {
        let Some(workspace_id) = self.workspace_of(entity_id, nodes).await? else {
            return Ok(false);
        };
        if !self.is_member_of_domain(user_id, entity_id).await? {
            return Ok(false);
        }
        Ok(self
            .role_in_table(&workspace_id, user)
            .await?
            .is_some_and(|role| role.grants(permission)))
    }

    /// Whether a live booking link names `user_id` a guest of an entity on `chain` (the entity,
    /// then each level above it).
    pub(crate) async fn guest_may_view(
        &self,
        user_id: &str,
        chain: &[&str],
    ) -> Result<bool, NetworkError> {
        let now_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|e| NetworkError::msg(format!("The server clock is before the epoch: {e}")))?
            .as_millis() as u64;
        let nodes = self
            .backend_tx_manager
            .live_guest_nodes(user_id, now_ms)
            .await?;
        let nodes: BTreeSet<&str> = nodes.iter().map(String::as_str).collect();
        Ok(covers(&nodes, chain))
    }
}
