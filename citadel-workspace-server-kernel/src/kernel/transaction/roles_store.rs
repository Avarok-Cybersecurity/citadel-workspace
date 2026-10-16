//! A workspace's role table, under one key per workspace.
//!
//! Read lazily: a workspace whose table was never written has the seeds, so no stored workspace
//! needs migrating, and a read never writes. Only the editable roles are stored; the Owner is
//! put back by `WorkspaceRoles::normalized` on every read.

use super::BackendTransactionManager;
use citadel_sdk::prelude::{NetworkError, Ratchet};
use citadel_workspace_types::roles::WorkspaceRoles;

const KEY_PREFIX_ROLES: &str = "citadel_workspace.roles.";

impl<R: Ratchet + Send + Sync + 'static> BackendTransactionManager<R> {
    /// The table of `workspace_id`, Owner first.
    pub async fn get_roles(&self, workspace_id: &str) -> Result<WorkspaceRoles, NetworkError> {
        let stored: Option<WorkspaceRoles> = self
            .backend_get(&format!("{KEY_PREFIX_ROLES}{workspace_id}"))
            .await?;
        Ok(stored.map_or_else(WorkspaceRoles::seeded, WorkspaceRoles::normalized))
    }

    /// Store `roles` as the table of `workspace_id`. The caller holds `lock_workspaces` across
    /// its read and this write.
    pub async fn save_roles(
        &self,
        workspace_id: &str,
        roles: &WorkspaceRoles,
    ) -> Result<(), NetworkError> {
        let editable = WorkspaceRoles {
            roles: roles.editable(),
        };
        self.backend_save(&format!("{KEY_PREFIX_ROLES}{workspace_id}"), &editable)
            .await
    }

    /// Forget the table of a workspace that no longer exists.
    pub async fn delete_roles(&self, workspace_id: &str) -> Result<(), NetworkError> {
        self.backend_delete(&format!("{KEY_PREFIX_ROLES}{workspace_id}"))
            .await
    }
}
