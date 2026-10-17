//! Writing a member's role, and the guard that keeps someone able to manage roles.

use super::async_domain_server_ops::AsyncDomainServerOperations;
use super::role_authority::Assignment;
use crate::WORKSPACE_ROOT_ID;
use citadel_sdk::prelude::{NetworkError, Ratchet};
use citadel_workspace_types::roles_legacy::legacy_mirror;
use citadel_workspace_types::structs::{Permission, User, UserRole};

/// Make `assignment` the account's role in the root workspace.
///
/// The enum is written alongside the id for clients that read only `User::role`; nothing reads
/// it for authority but `Banned`. Banning clears every grant, everywhere: a per-node grant is
/// honoured before the role, so one left behind would outlive the ban.
pub fn assign_workspace_role(user: &mut User, assignment: &Assignment) {
    match assignment {
        Assignment::Role(role) => {
            user.workspace_roles
                .insert(WORKSPACE_ROOT_ID.to_string(), role.id.clone());
            user.role = legacy_mirror(&role.id, &role.name);
        }
        Assignment::Banned => {
            user.workspace_roles.remove(WORKSPACE_ROOT_ID);
            user.role = UserRole::Banned;
            user.permissions.clear();
        }
    }
}

fn grants_manage_roles_directly(user: &User) -> bool {
    user.permissions
        .get(WORKSPACE_ROOT_ID)
        .is_some_and(|granted| Permission::has_permission(granted, &Permission::ManageRoles))
}

impl<R: Ratchet + Send + Sync + 'static> AsyncDomainServerOperations<R> {
    /// Refuse a change that would leave nobody able to manage roles.
    ///
    /// Unrecoverable otherwise: assigning a role takes `ManageRoles`, so a workspace with nobody
    /// holding it can never give it to anyone. `after` is what the target will hold, `None` when
    /// they are being removed. A no-op when the target cannot manage roles now, so ordinary
    /// member management is unaffected.
    ///
    /// Not needed for edits to the table itself. The actor of one holds `ManageRoles` and a
    /// role, cannot edit their own role (it is not below them), and keeps their own grants, so
    /// every table edit leaves at least the actor able to manage roles.
    pub(crate) async fn ensure_managers_remain(
        &self,
        target_user_id: &str,
        after: Option<&Assignment>,
        action: &str,
    ) -> Result<(), NetworkError> {
        if !self
            .holds_workspace_permission(target_user_id, Permission::ManageRoles)
            .await?
        {
            return Ok(());
        }
        let keeps = match after {
            Some(Assignment::Role(role)) => {
                role.grants(Permission::ManageRoles)
                    || self
                        .backend_tx_manager
                        .get_user(target_user_id)
                        .await?
                        .as_ref()
                        .is_some_and(grants_manage_roles_directly)
            }
            Some(Assignment::Banned) | None => false,
        };
        if keeps {
            return Ok(());
        }
        let Some(workspace) = self
            .backend_tx_manager
            .get_workspace(WORKSPACE_ROOT_ID)
            .await?
        else {
            return Ok(());
        };
        for member_id in workspace.members.iter().filter(|m| *m != target_user_id) {
            if self
                .holds_workspace_permission(member_id, Permission::ManageRoles)
                .await?
            {
                return Ok(());
            }
        }
        Err(NetworkError::msg(format!(
            "Cannot {action} the only member who can manage roles. Give someone else a role \
             with Manage roles first; otherwise nobody could ever assign a role again."
        )))
    }

    /// Set a member's role, refusing any write that would leave nobody able to manage roles.
    ///
    /// The lock is taken here because the check and the write have to be atomic together: two
    /// managers demoting each other would otherwise both count two, both pass, and both write.
    pub(crate) async fn write_user_role(
        &self,
        user_id: &str,
        assignment: &Assignment,
        domain_id: &str,
        create_if_missing: bool,
    ) -> Result<(), NetworkError> {
        let _workspace_guard = self.backend_tx_manager.lock_workspaces().await;
        self.write_user_role_locked(user_id, assignment, domain_id, create_if_missing)
            .await
    }

    /// The body of `write_user_role`, for a caller that already holds `lock_workspaces`
    /// (tokio's Mutex is not reentrant).
    ///
    /// Only a write at the workspace root changes the workspace role. A write on a node is a
    /// per-node grant of the role's permissions as they are now, so adding an Admin to a room
    /// as a Guest does not make them a Guest everywhere. An account that does not exist yet has
    /// no workspace role to preserve, so it is created holding the one it was given.
    pub(crate) async fn write_user_role_locked(
        &self,
        user_id: &str,
        assignment: &Assignment,
        domain_id: &str,
        create_if_missing: bool,
    ) -> Result<(), NetworkError> {
        let scopes_workspace_role = domain_id == WORKSPACE_ROOT_ID;
        if scopes_workspace_role {
            self.ensure_managers_remain(user_id, Some(assignment), "demote")
                .await?;
        }

        let (mut user, is_new) = match self.backend_tx_manager.get_user(user_id).await? {
            Some(user) => (user, false),
            None if create_if_missing => (
                User::new(user_id.to_string(), user_id.to_string(), UserRole::Member),
                true,
            ),
            None => return Err(NetworkError::msg("User not found")),
        };

        if scopes_workspace_role || is_new {
            assign_workspace_role(&mut user, assignment);
        }
        if !scopes_workspace_role && !user.is_banned() {
            user.permissions
                .insert(domain_id.to_string(), assignment.permissions());
        }

        self.backend_tx_manager
            .insert_user(user_id.to_string(), user)
            .await
    }
}
