//! A workspace's role table, under one key per workspace.
//!
//! Read lazily: a workspace whose table was never written has the seeds, so no stored workspace
//! needs migrating, and a read never writes. Only the editable roles are stored; the Owner is
//! put back by `WorkspaceRoles::normalized` on every read. A table stored before it named new
//! members' role is read with the legacy-load rule (`roles_stored`).

use super::BackendTransactionManager;
use citadel_logging::warn;
use citadel_sdk::prelude::{NetworkError, Ratchet};
use citadel_workspace_types::roles::WorkspaceRoles;
use citadel_workspace_types::roles_stored::{DefaultRoleRead, StoredRoles};

const KEY_PREFIX_ROLES: &str = "citadel_workspace.roles.";

impl<R: Ratchet + Send + Sync + 'static> BackendTransactionManager<R> {
    /// The table of `workspace_id`, Owner first.
    pub async fn get_roles(&self, workspace_id: &str) -> Result<WorkspaceRoles, NetworkError> {
        let stored: Option<StoredRoles> = self
            .backend_get(&format!("{KEY_PREFIX_ROLES}{workspace_id}"))
            .await?;
        let Some(stored) = stored else {
            return Ok(WorkspaceRoles::seeded());
        };
        let (table, read) = stored.into_table();
        if let DefaultRoleRead::Dangling { named } = read {
            warn!(target: "citadel", "{workspace_id}'s role table gives new members '{named}', which it does not have as a role below the Owner; reading '{}' instead", table.default_role_id);
        }
        Ok(table)
    }

    /// Store `roles` as the table of `workspace_id`. The caller holds `lock_workspaces` across
    /// its read and this write.
    pub async fn save_roles(
        &self,
        workspace_id: &str,
        roles: &WorkspaceRoles,
    ) -> Result<(), NetworkError> {
        self.backend_save(
            &format!("{KEY_PREFIX_ROLES}{workspace_id}"),
            &StoredRoles::of(roles),
        )
        .await
    }

    /// Forget the table of a workspace that no longer exists.
    pub async fn delete_roles(&self, workspace_id: &str) -> Result<(), NetworkError> {
        self.backend_delete(&format!("{KEY_PREFIX_ROLES}{workspace_id}"))
            .await
    }
}
