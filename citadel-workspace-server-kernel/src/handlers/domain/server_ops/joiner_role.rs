//! The role an account is given when it joins the workspace on its own: the table's default.
//!
//! The one place a joiner's role is chosen. The default is part of the role table
//! (`WorkspaceRoles::default_role_id`), which administrators set, so a role id written here in
//! code would outlive the role it named.

use super::async_domain_server_ops::AsyncDomainServerOperations;
use super::role_authority::Assignment;
use super::role_writes::assign_workspace_role;
use crate::WORKSPACE_ROOT_ID;
use citadel_sdk::prelude::{NetworkError, Ratchet};
use citadel_workspace_types::structs::{User, UserRole};

impl<R: Ratchet + Send + Sync + 'static> AsyncDomainServerOperations<R> {
    /// Give `user_id`, joining on connect, the workspace's default role.
    ///
    /// An account never seen is created as `display_name`. One whose record already names a
    /// root role keeps it: an administrator chose it (adding them to a room before they first
    /// connected, say). A banned account is left alone; the connection handler refuses it first.
    /// The caller holds `lock_workspaces`.
    pub async fn give_joiner_the_default_role(
        &self,
        user_id: &str,
        display_name: String,
    ) -> Result<(), NetworkError> {
        let mut user = match self.backend_tx_manager.get_user(user_id).await? {
            Some(user) if user.is_banned() || user.role_id_in(WORKSPACE_ROOT_ID).is_some() => {
                return Ok(())
            }
            Some(user) => user,
            None => User::new(user_id.to_string(), display_name, UserRole::Member),
        };
        let roles = self.backend_tx_manager.get_roles(WORKSPACE_ROOT_ID).await?;
        // The gate on this write: only the table's default, which `RoleChange::MakeDefault`
        // sets under the containment `role_edits` applies to every assignment.
        let default = match roles.default_role() {
            Some(role) => role.clone(),
            None => {
                return Err(NetworkError::msg(format!(
                    "New members get '{}', which is not a role below the Owner",
                    roles.default_role_id
                )))
            }
        };
        assign_workspace_role(&mut user, &Assignment::Role(default));
        self.backend_tx_manager
            .insert_user(user_id.to_string(), user)
            .await
    }
}
