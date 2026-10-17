//! Who holds which role, and the ladder every role or permission change climbs.
//!
//! A member's authority is their role in the workspace's table (`roles`), plus any per-node
//! grants. Position decides who may manage whom: nobody but the Owner may assign, edit or act on
//! a role at or above their own, and nobody hands out a permission their own role lacks. The
//! Owner is above every role, so it is exempt from the ladder, though not from the guard that
//! keeps someone able to manage roles (`role_writes`).

use super::async_domain_server_ops::AsyncDomainServerOperations;
use crate::handlers::domain::async_ops::AsyncPermissionOperations;
use crate::WORKSPACE_ROOT_ID;
use citadel_logging::warn;
use citadel_sdk::prelude::{NetworkError, Ratchet};
use citadel_workspace_types::roles::{
    first_missing, owner_permissions, RoleDefinition, OWNER_ROLE_ID,
};
use citadel_workspace_types::roles_legacy::legacy_role_id;
use citadel_workspace_types::roles_protocol::MemberRole;
use citadel_workspace_types::structs::{DomainNode, Permission, User, UserRole};
use std::collections::{HashMap, HashSet};

/// What a role write hands out: a role from the table, or the Banned standing.
#[derive(Debug, Clone)]
pub enum Assignment {
    Role(RoleDefinition),
    Banned,
}

impl Assignment {
    pub fn permissions(&self) -> HashSet<Permission> {
        match self {
            Assignment::Role(role) => role.permissions.clone(),
            Assignment::Banned => HashSet::new(),
        }
    }
}

impl<R: Ratchet + Send + Sync + 'static> AsyncDomainServerOperations<R> {
    /// The role `user` holds in `workspace_id`'s table, whether or not they are a member: the
    /// one place a role id becomes permissions. None when banned, holding no role there, or
    /// naming a role the table no longer has.
    pub(crate) async fn role_in_table(
        &self,
        workspace_id: &str,
        user: &User,
    ) -> Result<Option<RoleDefinition>, NetworkError> {
        let Some(role_id) = user.role_id_in(workspace_id) else {
            return Ok(None);
        };
        let roles = self.backend_tx_manager.get_roles(workspace_id).await?;
        match roles.get(role_id) {
            Some(role) => Ok(Some(role.clone())),
            None => {
                warn!(target: "citadel", "{} holds role '{}', which {} no longer has", user.id, role_id, workspace_id);
                Ok(None)
            }
        }
    }

    /// The role `user` holds as a member of `workspace_id`; None for a non-member, whose
    /// record may still name a role but who holds no standing there.
    pub async fn role_of(
        &self,
        workspace_id: &str,
        user: &User,
    ) -> Result<Option<RoleDefinition>, NetworkError> {
        if !self.is_member_of_domain(&user.id, workspace_id).await? {
            return Ok(None);
        }
        self.role_in_table(workspace_id, user).await
    }

    /// The actor's role in the workspace, or a refusal: authority comes from holding one.
    pub(crate) async fn actor_role(
        &self,
        actor_user_id: &str,
    ) -> Result<RoleDefinition, NetworkError> {
        let denied = || NetworkError::msg("Permission denied: you hold no role in this workspace");
        let actor = self
            .backend_tx_manager
            .get_user(actor_user_id)
            .await?
            .ok_or_else(denied)?;
        self.role_of(WORKSPACE_ROOT_ID, &actor)
            .await?
            .ok_or_else(denied)
    }

    /// Whether `user_id` holds `permission` across the workspace: by role, or by a grant on the
    /// workspace itself. What every former Admin-only gate asks now, each for its own permission.
    pub async fn holds_workspace_permission(
        &self,
        user_id: &str,
        permission: Permission,
    ) -> Result<bool, NetworkError> {
        self.check_entity_permission(user_id, WORKSPACE_ROOT_ID, permission)
            .await
    }

    /// The table entry a request names. A legacy enum role names its built-in; `Custom` names
    /// nothing in the table and is refused rather than guessed at.
    pub(crate) async fn resolve_assignment(
        &self,
        role: &MemberRole,
    ) -> Result<Assignment, NetworkError> {
        let role_id = match role {
            MemberRole::Legacy(UserRole::Custom(name, _)) => {
                return Err(NetworkError::msg(format!(
                    "'{name}' is not a role in this workspace; create it in the role table and assign it by id"
                )))
            }
            MemberRole::Legacy(legacy) => match legacy_role_id(legacy) {
                Some(id) => id,
                None => return Ok(Assignment::Banned),
            },
            MemberRole::Id(id) => id.as_str(),
        };
        let roles = self.backend_tx_manager.get_roles(WORKSPACE_ROOT_ID).await?;
        roles
            .get(role_id)
            .cloned()
            .map(Assignment::Role)
            .ok_or_else(|| {
                NetworkError::msg(format!("No role '{role_id}' exists in this workspace"))
            })
    }

    /// Refuse assigning a role the actor may not hand out.
    ///
    /// Below the actor's own position, and holding nothing the actor's role lacks: a role is a
    /// bundle of permissions, and assigning it grants every one. The Owner may assign anything.
    ///
    /// One exception, the vacant Owner seat. A workspace created before the bootstrap account
    /// became its Owner has an Admin and no Owner, and nobody below the Owner could ever fill
    /// the seat. So while no member holds it, an actor whose role confers everything the Owner's
    /// does may assign it. It closes behind itself: once anyone holds it, it is above them.
    pub(crate) async fn ensure_may_grant_role(
        &self,
        actor_user_id: &str,
        assignment: &Assignment,
    ) -> Result<(), NetworkError> {
        let Assignment::Role(role) = assignment else {
            return Ok(());
        };
        let actor = self.actor_role(actor_user_id).await?;
        if actor.is_owner() {
            return Ok(());
        }
        if role.position < actor.position {
            return match first_missing(&actor.permissions, &role.permissions) {
                None => Ok(()),
                Some(missing) => Err(NetworkError::msg(format!(
                    "Permission denied: {} cannot assign {}, which carries {missing:?} that they do not hold",
                    actor.name, role.name
                ))),
            };
        }
        if role.is_owner()
            && first_missing(&actor.permissions, &owner_permissions()).is_none()
            && self.no_member_holds(OWNER_ROLE_ID).await?
        {
            return Ok(());
        }
        Err(NetworkError::msg(format!(
            "Permission denied: {} cannot assign {}, which is not below their own role",
            actor.name, role.name
        )))
    }

    /// Refuse handing out a permission the actor's role does not confer.
    pub(crate) async fn ensure_may_grant_permissions(
        &self,
        actor_user_id: &str,
        granting: &[Permission],
    ) -> Result<(), NetworkError> {
        let actor = self.actor_role(actor_user_id).await?;
        match first_missing(&actor.permissions, granting) {
            None => Ok(()),
            Some(missing) => Err(NetworkError::msg(format!(
                "Permission denied: {} does not hold {missing:?} and cannot grant it",
                actor.name
            ))),
        }
    }

    /// Refuse acting on a member whose role is not below the actor's.
    ///
    /// The other half of `ensure_may_grant_role`: nobody may demote, ban, remove or strip the
    /// grants of someone at or above them. Banning grants nothing, so the granting check alone
    /// would let anyone ban anyone. A banned or roleless member is below everyone.
    ///
    /// Self-action is exempt, since standing down hands nobody anything; `role_writes` refuses
    /// the one case that matters, the last member who can manage roles. So is a target who is
    /// not a member: admitting someone is not unseating them.
    pub(crate) async fn ensure_may_act_on(
        &self,
        actor_user_id: &str,
        target_user_id: &str,
        action: &str,
    ) -> Result<(), NetworkError> {
        if actor_user_id == target_user_id {
            return Ok(());
        }
        let Some(target) = self.backend_tx_manager.get_user(target_user_id).await? else {
            return Ok(());
        };
        if !self
            .is_member_of_domain(target_user_id, WORKSPACE_ROOT_ID)
            .await?
        {
            return Ok(());
        }
        let actor = self.actor_role(actor_user_id).await?;
        if actor.is_owner() {
            return Ok(());
        }
        let target_role = self.role_of(WORKSPACE_ROOT_ID, &target).await?;
        let target_position = target_role.as_ref().map_or(0, |role| role.position);
        if target_position < actor.position {
            return Ok(());
        }
        Err(NetworkError::msg(format!(
            "Permission denied: {} cannot {action} {target_user_id}, whose role is not below theirs",
            actor.name
        )))
    }

    /// The workspace `entity_id` belongs to: itself when it is one, else the one at the top of
    /// its parent chain. None for an id that is neither, or a chain that never reaches one.
    pub(crate) async fn workspace_of(
        &self,
        entity_id: &str,
        nodes: &HashMap<String, DomainNode>,
    ) -> Result<Option<String>, NetworkError> {
        let mut visited: HashSet<&str> = HashSet::new();
        let mut current = entity_id;
        while visited.insert(current) {
            if self
                .backend_tx_manager
                .get_workspace(current)
                .await?
                .is_some()
            {
                return Ok(Some(current.to_string()));
            }
            match nodes
                .get(current)
                .and_then(|node| node.parent_id.as_deref())
            {
                Some(parent) => current = parent,
                None => return Ok(None),
            }
        }
        Ok(None)
    }

    /// Whether no member of the workspace holds `role_id`.
    pub(crate) async fn no_member_holds(&self, role_id: &str) -> Result<bool, NetworkError> {
        let Some(workspace) = self
            .backend_tx_manager
            .get_workspace(WORKSPACE_ROOT_ID)
            .await?
        else {
            return Ok(true);
        };
        for member_id in &workspace.members {
            if let Some(member) = self.backend_tx_manager.get_user(member_id).await? {
                if member.role_id_in(WORKSPACE_ROOT_ID) == Some(role_id) {
                    return Ok(false);
                }
            }
        }
        Ok(true)
    }
}
