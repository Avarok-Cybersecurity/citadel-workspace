//! Banning and unbanning a member: a standing on the account record, not a role.
//!
//! A ban takes the account's role in every workspace and every grant, and keeps the record so
//! the ban outlasts reconnecting. Join and admission paths ask `ensure_not_banned` first.

use super::async_domain_server_ops::AsyncDomainServerOperations;
use super::role_writes::ban_record;
use crate::WORKSPACE_ROOT_ID;
use citadel_sdk::prelude::{NetworkError, Ratchet};
use citadel_workspace_types::roles::OWNER_ROLE_ID;
use citadel_workspace_types::structs::{Domain, Permission, User};

impl<R: Ratchet + Send + Sync + 'static> AsyncDomainServerOperations<R> {
    /// Refuse when `user_id` is banned. An account with no record is not.
    pub(crate) async fn ensure_not_banned(&self, user_id: &str) -> Result<(), NetworkError> {
        match self.backend_tx_manager.get_user(user_id).await? {
            Some(user) if user.is_banned() => Err(NetworkError::msg(format!(
                "{user_id} is banned from this workspace; unban them first"
            ))),
            _ => Ok(()),
        }
    }

    /// `RemoveUsers`, and a target below the caller: the rule removal and role changes follow.
    async fn ensure_may_change_standing(
        &self,
        actor_user_id: &str,
        target_user_id: &str,
        action: &str,
    ) -> Result<User, NetworkError> {
        if !self
            .holds_workspace_permission(actor_user_id, Permission::RemoveUsers)
            .await?
        {
            return Err(NetworkError::msg(format!(
                "Permission denied: RemoveUsers is required to {action} a member"
            )));
        }
        if actor_user_id == target_user_id {
            return Err(NetworkError::msg(format!("You cannot {action} yourself")));
        }
        self.ensure_may_act_on(actor_user_id, target_user_id, action)
            .await?;
        self.backend_tx_manager
            .get_user(target_user_id)
            .await?
            .ok_or_else(|| NetworkError::msg(format!("No account named '{target_user_id}'")))
    }

    /// Ban `target_user_id`. Never the Owner of any workspace, and never the last member who
    /// can manage roles.
    pub async fn ban_member(
        &self,
        actor_user_id: &str,
        target_user_id: &str,
    ) -> Result<(), NetworkError> {
        // Held across the checks and the write, so a promotion cannot land between them.
        let _workspace_guard = self.backend_tx_manager.lock_workspaces().await;
        let mut target = self
            .ensure_may_change_standing(actor_user_id, target_user_id, "ban")
            .await?;
        if target.is_banned() {
            return Err(NetworkError::msg(format!(
                "{target_user_id} is already banned"
            )));
        }
        if target
            .workspace_roles
            .values()
            .any(|role_id| role_id == OWNER_ROLE_ID)
        {
            return Err(NetworkError::msg(format!(
                "Permission denied: {target_user_id} owns a workspace and cannot be banned"
            )));
        }
        self.ensure_managers_remain(target_user_id, None, "ban")
            .await?;
        ban_record(&mut target);
        self.backend_tx_manager
            .insert_user(target_user_id.to_string(), target)
            .await
    }

    /// Lift `target_user_id`'s ban and readmit them to the workspace with the role the table
    /// gives new members, as `AddMember` did before bans were a standing. Returns that role's id.
    pub async fn unban_member(
        &self,
        actor_user_id: &str,
        target_user_id: &str,
    ) -> Result<String, NetworkError> {
        let _workspace_guard = self.backend_tx_manager.lock_workspaces().await;
        let mut target = self
            .ensure_may_change_standing(actor_user_id, target_user_id, "unban")
            .await?;
        if !target.is_banned() {
            return Err(NetworkError::msg(format!("{target_user_id} is not banned")));
        }
        target.banned = false;
        let name = target.name.clone();
        self.backend_tx_manager
            .insert_user(target_user_id.to_string(), target)
            .await?;
        self.list_root_member(target_user_id).await?;
        self.give_joiner_the_default_role(target_user_id, name)
            .await?;
        self.backend_tx_manager
            .get_user(target_user_id)
            .await?
            .and_then(|user| user.role_id_in(WORKSPACE_ROOT_ID).map(str::to_string))
            .ok_or_else(|| NetworkError::msg(format!("{target_user_id} holds no role after unban")))
    }

    /// Every banned account, by id: a removed member's record outlives the roster, and so does its
    /// ban, so this reads the records rather than a roster. Needs `RemoveUsers`, as an unban does.
    pub async fn list_banned(&self, actor_user_id: &str) -> Result<Vec<User>, NetworkError> {
        if !self
            .holds_workspace_permission(actor_user_id, Permission::RemoveUsers)
            .await?
        {
            return Err(NetworkError::msg(
                "Permission denied: RemoveUsers is required to list banned members",
            ));
        }
        let mut banned: Vec<User> = self
            .backend_tx_manager
            .get_all_users()
            .await?
            .into_values()
            .filter(User::is_banned)
            .collect();
        banned.sort_by(|a, b| a.id.cmp(&b.id));
        Ok(banned)
    }

    /// List `user_id` in the root workspace and its `Domain::Workspace` copy, which `ListMembers`
    /// reads first. The caller holds `lock_workspaces`.
    pub(crate) async fn list_root_member(&self, user_id: &str) -> Result<(), NetworkError> {
        let mut workspace = self
            .backend_tx_manager
            .get_workspace(WORKSPACE_ROOT_ID)
            .await?
            .ok_or_else(|| NetworkError::msg("Workspace not found"))?;
        if !workspace.members.iter().any(|member| member == user_id) {
            workspace.members.push(user_id.to_string());
        }
        self.backend_tx_manager
            .insert_workspace(WORKSPACE_ROOT_ID.to_string(), workspace.clone())
            .await?;
        self.backend_tx_manager
            .insert_domain(
                WORKSPACE_ROOT_ID.to_string(),
                Domain::Workspace { workspace },
            )
            .await
    }
}
