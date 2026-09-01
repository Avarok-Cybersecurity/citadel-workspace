//! # Async Domain Server Operations
//!
//! This module provides the async implementation of all domain operations
//! using the BackendTransactionManager for persistence.

use crate::handlers::domain::async_ops::*;
use crate::handlers::domain::core::DomainEntity;
use crate::kernel::transaction::BackendTransactionManager;
use async_trait::async_trait;
use citadel_logging::info;
use citadel_sdk::prelude::{NetworkError, NodeRemote, Ratchet};
use citadel_workspace_types::structs::{Domain, Permission, User, UserRole, Workspace};
use citadel_workspace_types::UpdateOperation;
use parking_lot::RwLock;
use std::sync::Arc;

/// Async domain server operations implementation
pub struct AsyncDomainServerOperations<R: Ratchet> {
    /// Backend transaction manager for async operations
    pub backend_tx_manager: Arc<BackendTransactionManager<R>>,
}

pub struct WorkspaceDBList {
    #[allow(dead_code)]
    /// Note: We will eventually expand to allowing multiple workspaces per server/kernel. For now, we just have
    /// one element: the root workspace
    workspaces: Vec<String>,
}

impl<R: Ratchet> Clone for AsyncDomainServerOperations<R> {
    fn clone(&self) -> Self {
        Self {
            backend_tx_manager: self.backend_tx_manager.clone(),
        }
    }
}

impl<R: Ratchet + Send + Sync + 'static> AsyncDomainServerOperations<R> {
    /// Admin or Owner.
    ///
    /// `is_admin` is `role == Admin` exactly, so every gate written on it
    /// refuses the workspace Owner — a role that `Permission::for_role` grants
    /// everything except `All` and `ConfigureSystem`. `remove_user_from_domain`
    /// already records this class of mistake ("the permission editor displayed
    /// a grant that enforcement then refused"); it was fixed there and nowhere
    /// else.
    ///
    /// Deliberately narrower than asking the permission — as a policy choice,
    /// not as the only thing standing between a Custom role and an
    /// administrator. It was written when that WAS the only thing: widening the
    /// gate would then have let a holder of a member-management permission mint
    /// an Admin.
    ///
    /// `ensure_may_grant_role` and `ensure_may_grant_permissions` closed that
    /// independently — nobody grants authority they do not hold, whichever gate
    /// admitted them — so the argument for keeping this narrow is now the
    /// smaller one: role assignment is an administrative act, and Admin and
    /// Owner are who the product means by administrator. Whether to widen it
    /// remains open, and is no longer blocked on the escalation.
    pub async fn is_admin_or_owner(&self, user_id: &str) -> Result<bool, NetworkError> {
        match self.backend_tx_manager.get_user(user_id).await? {
            Some(user) => Ok(matches!(user.role, UserRole::Admin | UserRole::Owner)),
            None => Ok(false),
        }
    }

    /// Refuse granting a role that holds a permission the grantor does not.
    ///
    /// `add_user_to_domain` writes a caller-supplied `UserRole` and was gated
    /// only on `AddUsers`, which `Permission::for_role` gives every Custom role
    /// above the editor threshold. Nothing looked at WHICH role was granted, and
    /// the target may be the caller — so a Custom role could call it on itself
    /// and climb. `update_workspace_member_role` is the same shape.
    ///
    /// This was first written as a rank comparison: grant what you outrank or
    /// match. That was wrong, because rank does not track power. `Owner` is rank
    /// 20 and holds 25 of the 27 permissions; `create_custom_role` permits ranks
    /// 21-254, and a Custom role above the editor threshold holds 9. So a
    /// rank-21 Custom outranked Owner while holding a third of its authority,
    /// and the rank rule let it grant Owner — to itself.
    ///
    /// Comparing the permission sets is the property actually wanted. `All` is
    /// the Admin wildcard and `has_permission` honours it, so an Admin still
    /// grants anything; an Owner grants everything except Admin, whose `All`
    /// they lack; and no role can hand out authority it does not itself hold.
    async fn ensure_may_grant_role(
        &self,
        actor_user_id: &str,
        role: &UserRole,
    ) -> Result<(), NetworkError> {
        let actor = match self.backend_tx_manager.get_user(actor_user_id).await? {
            Some(user) => user,
            None => return Err(NetworkError::msg("Permission denied: unknown actor")),
        };
        let granting: Vec<Permission> = Permission::for_role(role).into_iter().collect();
        self.ensure_may_grant_permissions(actor_user_id, &granting)
            .await
            .map_err(|_| {
                NetworkError::msg(format!(
                    "Permission denied: {} cannot grant {}, which carries authority it does not hold",
                    actor.role, role
                ))
            })
    }

    /// Refuse handing out a permission the actor does not itself hold.
    ///
    /// The role path was closed first, and `update_member_permissions` is the
    /// same escalation through the other door: it was gated on
    /// `is_admin_or_owner` and then wrote CALLER-SUPPLIED permissions straight
    /// into the target's per-domain map, target possibly being the caller. So an
    /// Owner could grant `Permission::All` — the Admin wildcard that
    /// `check_entity_permission` honours before anything else — and with it the
    /// `ConfigureSystem` that `for_role` deliberately withholds from Owner.
    ///
    /// Same rule as roles, since a role is only a bundle of these: grant what
    /// you hold, never more. Admin holds `All` and `has_permission` honours it,
    /// so an Admin may still grant anything.
    async fn ensure_may_grant_permissions(
        &self,
        actor_user_id: &str,
        granting: &[Permission],
    ) -> Result<(), NetworkError> {
        let actor = match self.backend_tx_manager.get_user(actor_user_id).await? {
            Some(user) => user,
            None => return Err(NetworkError::msg("Permission denied: unknown actor")),
        };
        let held = Permission::for_role(&actor.role);
        if let Some(missing) = granting
            .iter()
            .find(|p| !Permission::has_permission(&held, p))
        {
            return Err(NetworkError::msg(format!(
                "Permission denied: {} does not hold {missing:?} and cannot grant it",
                actor.role
            )));
        }
        Ok(())
    }

    /// Refuse anything that would leave the workspace with nobody who can
    /// administer it.
    ///
    /// Unrecoverable, because promotion itself requires that authority: there is
    /// no way back from a workspace with none. The admin UI offers demote and
    /// remove on the acting user's own row, which puts that state one click
    /// away — and it is exactly the state that made the product read-only for
    /// everyone before joining users were promoted.
    ///
    /// Counts Admin AND Owner, and fires for either as the target. It counted
    /// only Admin, which was right while `update_workspace_member_role` was
    /// gated on `is_admin`: an Owner could not promote, so an Owner was not an
    /// escape from an empty admin set, and could not reach the demote path
    /// either. Once the Owner gained that gate, the guard had to follow — an
    /// Owner alone in a workspace with no Admin could demote themselves to
    /// Member, and the guard would no-op because the target was not an Admin.
    ///
    /// A no-op when the target can administer nothing, so ordinary member
    /// management is unaffected.
    async fn ensure_not_last_admin(
        &self,
        target_user_id: &str,
        action: &str,
    ) -> Result<(), NetworkError> {
        let target = match self.backend_tx_manager.get_user(target_user_id).await? {
            Some(user) => user,
            None => return Ok(()),
        };
        if !matches!(target.role, UserRole::Admin | UserRole::Owner) {
            return Ok(());
        }

        let workspace = match self
            .backend_tx_manager
            .get_workspace(crate::WORKSPACE_ROOT_ID)
            .await?
        {
            Some(ws) => ws,
            None => return Ok(()),
        };

        let mut administrators = 0usize;
        for member_id in &workspace.members {
            if let Some(member) = self.backend_tx_manager.get_user(member_id).await? {
                if matches!(member.role, UserRole::Admin | UserRole::Owner) {
                    administrators += 1;
                }
            }
        }

        if administrators <= 1 {
            return Err(NetworkError::msg(format!(
                "Cannot {action} the only administrator. Promote another member to Admin or Owner \
                 first — otherwise nobody could manage the workspace, and the change cannot be \
                 undone."
            )));
        }
        Ok(())
    }

    /// Set a user's role, refusing any write that would empty the admin set.
    ///
    /// The lock is taken HERE rather than at the call sites, because it is the
    /// check and the write TOGETHER that have to be atomic, and leaving that to
    /// each caller is what produced the bug twice. `update_workspace_member_role`
    /// took no lock at all; `add_user_to_domain` took one, but scoped to its
    /// workspace-root branch, so it had already been dropped by the time the
    /// demote check ran. Two admins demoting each other both counted two, both
    /// passed, and both wrote — leaving zero admins, which
    /// `ensure_not_last_admin` documents as unrecoverable, since promotion
    /// requires an admin.
    ///
    /// `create_if_missing` is the only real difference between the two callers:
    /// adding a member may invent the user record, changing a role may not.
    async fn write_user_role(
        &self,
        user_id: &str,
        role: UserRole,
        domain_id: &str,
        create_if_missing: bool,
    ) -> Result<(), NetworkError> {
        let _workspace_guard = self.backend_tx_manager.lock_workspaces().await;

        if role != UserRole::Admin {
            self.ensure_not_last_admin(user_id, "demote").await?;
        }

        let mut user = match self.backend_tx_manager.get_user(user_id).await? {
            Some(u) => u,
            None if create_if_missing => {
                User::new(user_id.to_string(), user_id.to_string(), role.clone())
            }
            None => return Err(NetworkError::msg("User not found")),
        };

        user.role = role;
        user.set_role_permissions(domain_id);

        self.backend_tx_manager
            .insert_user(user_id.to_string(), user)
            .await?;
        Ok(())
    }

    /// Create a new AsyncDomainServerOperations instance
    pub fn new(
        backend_tx_manager: Arc<BackendTransactionManager<R>>,
        _node_remote: Arc<RwLock<Option<NodeRemote<R>>>>,
    ) -> Self {
        Self { backend_tx_manager }
    }
}

// Implement AsyncDomainOperations
#[async_trait]
impl<R: Ratchet + Send + Sync + 'static> AsyncDomainOperations<R>
    for AsyncDomainServerOperations<R>
{
    async fn init(&self) -> Result<(), NetworkError> {
        // Initialize the backend transaction manager
        self.backend_tx_manager.init().await
    }

    async fn is_admin(&self, user_id: &str) -> Result<bool, NetworkError> {
        // Check if user exists and has admin role
        match self.backend_tx_manager.get_user(user_id).await? {
            Some(user) => Ok(user.role == UserRole::Admin),
            None => Ok(false),
        }
    }

    async fn get_user(&self, user_id: &str) -> Result<Option<User>, NetworkError> {
        self.backend_tx_manager.get_user(user_id).await
    }

    async fn get_domain(&self, domain_id: &str) -> Result<Option<Domain>, NetworkError> {
        self.backend_tx_manager.get_domain(domain_id).await
    }
}

// Implement AsyncTransactionOperations
#[async_trait]
impl<R: Ratchet + Send + Sync + 'static> AsyncTransactionOperations<R>
    for AsyncDomainServerOperations<R>
{
    async fn with_read_transaction<F, Fut, T>(&self, f: F) -> Result<T, NetworkError>
    where
        F: FnOnce() -> Fut + Send,
        Fut: Future<Output = Result<T, NetworkError>> + Send,
        T: Send,
    {
        // For async operations, we just execute the function directly
        // The backend handles its own transactional semantics
        f().await
    }

    async fn with_write_transaction<F, Fut, T>(&self, f: F) -> Result<T, NetworkError>
    where
        F: FnOnce() -> Fut + Send,
        Fut: Future<Output = Result<T, NetworkError>> + Send,
        T: Send,
    {
        // For async operations, we just execute the function directly
        // The backend handles its own transactional semantics
        f().await
    }
}

// Add placeholder implementations for other traits
// These will be implemented as we migrate functionality

#[async_trait]
impl<R: Ratchet + Send + Sync + 'static> AsyncPermissionOperations<R>
    for AsyncDomainServerOperations<R>
{
    async fn check_entity_permission(
        &self,
        user_id: &str,
        entity_id: &str,
        permission: Permission,
    ) -> Result<bool, NetworkError> {
        // Check if user is admin first
        if self.is_admin(user_id).await? {
            return Ok(true);
        }

        // Get user from backend
        let user = match self.backend_tx_manager.get_user(user_id).await? {
            Some(u) => u,
            None => return Ok(false),
        };

        // Check direct permission for this entity
        if let Some(perms) = user.permissions.get(entity_id) {
            if perms.contains(&permission) || perms.contains(&Permission::All) {
                return Ok(true);
            }
        }

        // Check permission inheritance via DomainNode tree — walk up parent chain
        //
        // Guarded by a visited set. A cycle in `parent_id` is nothing the
        // mutation validators will create, but it can arrive by corruption or a
        // manual backend edit — and `is_ancestor_of` in tree_validator grew
        // exactly this guard for exactly that reason. Unguarded, one bad edge
        // does not fail one request: this walk runs on EVERY permission check,
        // so it would hang every request in the workspace forever.
        //
        // One snapshot of the node map, not one `get_node` per hop: `get_node`
        // deserialises the ENTIRE map each call, so the per-hop form cost
        // O(depth × N) on every permission check on every request. One read is
        // also one consistent view of the tree.
        let nodes = self.backend_tx_manager.get_all_nodes().await?;
        if let Some(node) = nodes.get(entity_id) {
            let mut visited: std::collections::HashSet<&str> = std::collections::HashSet::new();
            visited.insert(entity_id);
            let mut current_parent = node.parent_id.as_deref();
            while let Some(pid) = current_parent {
                if let Some(parent_perms) = user.permissions.get(pid) {
                    if parent_perms.contains(&permission) || parent_perms.contains(&Permission::All)
                    {
                        return Ok(true);
                    }
                }
                if !visited.insert(pid) {
                    // Already-walked ancestor: the chain is cyclic. Nothing new
                    // can grant the permission, so fall through to membership.
                    break;
                }
                // Continue up the tree
                current_parent = nodes.get(pid).and_then(|n| n.parent_id.as_deref());
            }
        }

        // Membership in a domain confers the permissions of the user's ROLE.
        //
        // This used to confer exactly one, ViewContent, and consult the role
        // for nothing. So a plain member of a workspace could read an office
        // and never post to it: `Permission::for_role` grants Member
        // SendMessages and ReadMessages, three separate role tables in this
        // repo say the same, and enforcement read none of them. Three
        // integration specs failed on it -- office chat, room chat and
        // touch-controls -- each with the composer replaced by "You do not
        // have permission to send messages here", which is how an unasked
        // question reads on screen.
        //
        // Scoped to membership deliberately: `user.role` is global, so
        // granting on it alone would let a member of one workspace act in
        // another. It widens nothing beyond the role's own set, so a Guest
        // still gets ViewContent and a Banned user still gets nothing -- the
        // previous behaviour granted ViewContent to a banned member.
        if Permission::for_role(&user.role).contains(&permission)
            && self.is_member_of_domain(user_id, entity_id).await?
        {
            return Ok(true);
        }

        Ok(false)
    }

    async fn is_member_of_domain(
        &self,
        user_id: &str,
        domain_id: &str,
    ) -> Result<bool, NetworkError> {
        // Workspaces are stored as Workspace records; DomainNodes are the tree
        // BELOW them. This used to test `domain_id == WORKSPACE_ROOT_ID`, which
        // is true of exactly one workspace — the seeded root. Every workspace
        // `create_workspace` mints gets a UUID id and is stored the same way, so
        // the node lookup below missed it and this returned false to EVERYONE,
        // including the creator we had just written into `members`. get_workspace
        // returns None for a node id, so trying it first covers all of them.
        if let Some(workspace) = self.backend_tx_manager.get_workspace(domain_id).await? {
            return Ok(workspace.members.contains(&user_id.to_string()));
        }

        // For all other entities, use DomainNode tree storage.
        //
        // An iterative walk with a visited set, not recursion. The recursive
        // form had no cycle guard, so a corrupted `parent_id` chain recursed
        // without bound — and like the walk in `check_entity_permission`, this
        // runs on permission checks, so one bad edge would take every request
        // with it. Each level still tries the Workspace record first, exactly
        // as the recursion did: the top of every office chain is a workspace
        // id, which exists only as a Workspace record, never as a stored node.
        //
        // One snapshot of the node map for the whole walk — the recursion's
        // per-level `get_node` deserialised the entire map each time,
        // O(depth × N) per membership check.
        let user_id_owned = user_id.to_string();
        let nodes = self.backend_tx_manager.get_all_nodes().await?;
        let mut visited: std::collections::HashSet<&str> = std::collections::HashSet::new();
        let mut current = domain_id;
        while visited.insert(current) {
            let node = match nodes.get(current) {
                Some(node) => node,
                None => break,
            };
            if node.members.contains(&user_id_owned) {
                return Ok(true);
            }
            let parent_id = match node.parent_id.as_deref() {
                Some(parent_id) => parent_id,
                None => break,
            };
            if let Some(workspace) = self.backend_tx_manager.get_workspace(parent_id).await? {
                return Ok(workspace.members.contains(&user_id_owned));
            }
            current = parent_id;
        }

        Ok(false)
    }
}

#[async_trait]
impl<R: Ratchet + Send + Sync + 'static> AsyncUserManagementOperations<R>
    for AsyncDomainServerOperations<R>
{
    async fn add_user_to_domain(
        &self,
        admin_id: &str,
        user_id_to_add: &str,
        domain_id: &str,
        role: UserRole,
    ) -> Result<(), NetworkError> {
        // Asked as the permission, not as the role.
        //
        // `GetUserPermissions` reports what `Permission::for_role` grants, and
        // an Owner is granted everything except `All` and `ConfigureSystem` --
        // AddUsers included. This gate asked `is_admin`, so the permission editor
        // displayed a grant that enforcement then refused, and any client that
        // gated its controls on the reported set (which that endpoint's own doc
        // invites) would ship dead buttons.
        //
        // `check_entity_permission` returns true for admins first, so this is a
        // widening only to holders of AddUsers: Owner, and Custom roles above the
        // editor rank. Member, Guest and Banned have it in no role table, and
        // it is scoped by `is_member_of_domain`, so an Owner of one workspace
        // gains nothing in another.
        if !self
            .check_entity_permission(admin_id, domain_id, Permission::AddUsers)
            .await?
        {
            return Err(NetworkError::msg(
                "Permission denied: AddUsers is required to manage members",
            ));
        }

        // AddUsers says they may add somebody; it says nothing about the role
        // they may hand out, and `user_id_to_add` may be the caller.
        self.ensure_may_grant_role(admin_id, &role).await?;

        // If this is the workspace root, use the workspace storage
        if domain_id == crate::WORKSPACE_ROOT_ID {
            // Same lock as the connect path and update_workspace — this branch
            // reads the workspace whole and writes it back, so without it those
            // fixes only exclude each other.
            let _workspace_guard = self.backend_tx_manager.lock_workspaces().await;

            let mut workspace = match self.backend_tx_manager.get_workspace(domain_id).await? {
                Some(ws) => ws,
                None => return Err(NetworkError::msg("Workspace not found")),
            };

            if !workspace.members.contains(&user_id_to_add.to_string()) {
                workspace.members.push(user_id_to_add.to_string());
            }

            self.backend_tx_manager
                .insert_workspace(domain_id.to_string(), workspace.clone())
                .await?;

            // The denormalized Domain::Workspace copy, which UpdateWorkspaceTheme
            // documents as the invariant every workspace mutator maintains — and
            // which the two membership mutators did not. ListMembers reads the
            // Domain copy FIRST, so an added member never appeared in the roster
            // and a removed one never left it, while enforcement read the fresh
            // workspace record. The displayed roster and the enforced roster
            // disagreed permanently, in both directions, with no race required.
            self.backend_tx_manager
                .insert_domain(
                    domain_id.to_string(),
                    Domain::Workspace {
                        workspace: workspace.clone(),
                    },
                )
                .await?;
        } else {
            // For all other entities, use DomainNode tree storage.
            // lock_nodes across the whole get_all_nodes ... save_nodes cycle:
            // create/delete/move_node all take it, but these two did not, and a
            // mutex only excludes participants. A member add overlapping a room
            // creation loaded the pre-insert map and saved it back — erasing the
            // room create_node had already reported as created.
            let _nodes_guard = self.backend_tx_manager.lock_nodes().await;
            let mut nodes = self.backend_tx_manager.get_all_nodes().await?;
            let node = nodes
                .get_mut(domain_id)
                .ok_or_else(|| NetworkError::msg("Domain not found"))?;
            if !node.members.contains(&user_id_to_add.to_string()) {
                node.members.push(user_id_to_add.to_string());
            }
            self.backend_tx_manager.save_nodes(&nodes).await?;
        }

        // Role write and last-admin check, both under one lock. See
        // `write_user_role`: this used to run with no lock held at all, because
        // the guard above is scoped to the workspace-root branch and has been
        // dropped by the time execution reaches here.
        self.write_user_role(user_id_to_add, role, domain_id, true)
            .await?;

        Ok(())
    }

    async fn remove_user_from_domain(
        &self,
        admin_id: &str,
        user_id_to_remove: &str,
        domain_id: &str,
    ) -> Result<(), NetworkError> {
        // Asked as the permission, not as the role.
        //
        // `GetUserPermissions` reports what `Permission::for_role` grants, and
        // an Owner is granted everything except `All` and `ConfigureSystem` --
        // RemoveUsers included. This gate asked `is_admin`, so the permission editor
        // displayed a grant that enforcement then refused, and any client that
        // gated its controls on the reported set (which that endpoint's own doc
        // invites) would ship dead buttons.
        //
        // `check_entity_permission` returns true for admins first, so this is a
        // widening only to holders of RemoveUsers: Owner, and Custom roles above the
        // editor rank. Member, Guest and Banned have it in no role table, and
        // it is scoped by `is_member_of_domain`, so an Owner of one workspace
        // gains nothing in another.
        if !self
            .check_entity_permission(admin_id, domain_id, Permission::RemoveUsers)
            .await?
        {
            return Err(NetworkError::msg(
                "Permission denied: RemoveUsers is required to manage members",
            ));
        }

        // If this is the workspace root, use the workspace storage
        if domain_id == crate::WORKSPACE_ROOT_ID {
            // BEFORE the last-admin check, not after.
            //
            // `ensure_not_last_admin` counts admins and returns; the write
            // happens separately. Two admins removing each other both counted
            // 2, both passed, and both writes landed — leaving ZERO admins,
            // which the check's own doc calls unrecoverable: "promotion
            // requires an admin, so there is no way back".
            //
            // Holding the lock across check AND write is what makes the guard
            // mean anything. It also covers the workspace read-modify-write
            // below, which is the same erased-member race the connect path and
            // update_workspace take this lock for.
            let _workspace_guard = self.backend_tx_manager.lock_workspaces().await;

            self.ensure_not_last_admin(user_id_to_remove, "remove")
                .await?;

            let mut workspace = match self.backend_tx_manager.get_workspace(domain_id).await? {
                Some(ws) => ws,
                None => return Err(NetworkError::msg("Workspace not found")),
            };

            workspace.members.retain(|m| m != user_id_to_remove);

            self.backend_tx_manager
                .insert_workspace(domain_id.to_string(), workspace.clone())
                .await?;

            // The denormalized Domain::Workspace copy, which UpdateWorkspaceTheme
            // documents as the invariant every workspace mutator maintains — and
            // which the two membership mutators did not. ListMembers reads the
            // Domain copy FIRST, so an added member never appeared in the roster
            // and a removed one never left it, while enforcement read the fresh
            // workspace record. The displayed roster and the enforced roster
            // disagreed permanently, in both directions, with no race required.
            self.backend_tx_manager
                .insert_domain(
                    domain_id.to_string(),
                    Domain::Workspace {
                        workspace: workspace.clone(),
                    },
                )
                .await?;

            // Drop the role as well as the membership, or the removed user is a
            // "ghost admin": `is_admin` reads the GLOBAL `user.role` and never
            // consults the member list, so a removed administrator keeps passing
            // every permission gate — while ensure_not_last_admin, which counts
            // admins among `workspace.members`, can no longer see them. Two
            // admins could then remove each other down to zero and the next
            // account to register would be promoted as "first member".
            if let Some(mut removed) = self.backend_tx_manager.get_user(user_id_to_remove).await? {
                if removed.role == UserRole::Admin {
                    removed.role = UserRole::Member;
                    removed.set_role_permissions(crate::WORKSPACE_ROOT_ID);
                    self.backend_tx_manager
                        .insert_user(user_id_to_remove.to_string(), removed)
                        .await?;
                }
            }
        } else {
            // For all other entities, use DomainNode tree storage.
            // lock_nodes across the whole get_all_nodes ... save_nodes cycle:
            // create/delete/move_node all take it, but these two did not, and a
            // mutex only excludes participants. A member add overlapping a room
            // creation loaded the pre-insert map and saved it back — erasing the
            // room create_node had already reported as created.
            let _nodes_guard = self.backend_tx_manager.lock_nodes().await;
            let mut nodes = self.backend_tx_manager.get_all_nodes().await?;
            let node = nodes
                .get_mut(domain_id)
                .ok_or_else(|| NetworkError::msg("Domain not found"))?;
            node.members.retain(|m| m != user_id_to_remove);
            self.backend_tx_manager.save_nodes(&nodes).await?;
        }

        // Remove the user's own `permissions[domain_id]` grant, under the lock
        // every other user-record writer takes. This read-modify-write ran with
        // NO lock — both branch guards above are scoped to their branches and
        // have dropped by the time execution reaches here — which is the third
        // site of the race `write_user_role` and `delete_workspace`'s cleanup
        // both document: a concurrent user write lands between `get_user` and
        // `insert_user` and one side is silently lost. Lost here means either a
        // concurrent role change is reverted, or this removal is — and
        // `check_entity_permission` honours `user.permissions[domain_id]`
        // BEFORE membership, so a surviving grant keeps the removed user's
        // access enforceable.
        //
        // Taken fresh rather than held from the workspace branch: tokio's Mutex
        // is not reentrant, and the branch guards are gone by now, so this
        // cannot deadlock with them.
        let _workspace_guard = self.backend_tx_manager.lock_workspaces().await;
        if let Some(mut user) = self.backend_tx_manager.get_user(user_id_to_remove).await? {
            user.permissions.remove(domain_id);
            self.backend_tx_manager
                .insert_user(user_id_to_remove.to_string(), user)
                .await?;
        }

        Ok(())
    }

    async fn update_workspace_member_role(
        &self,
        actor_user_id: &str,
        target_user_id: &str,
        role: UserRole,
        metadata: Option<Vec<u8>>,
    ) -> Result<(), NetworkError> {
        // Owner too: see `is_admin_or_owner`. Gated on `is_admin` alone, the
        // workspace Owner could not change any member's role in their own
        // workspace, while the permission editor showed them holding the grant.
        if !self.is_admin_or_owner(actor_user_id).await? {
            return Err(NetworkError::msg(
                "Permission denied: only an admin or the owner can update member roles",
            ));
        }

        // Same reach as `add_user_to_domain`: an Owner admitted by the gate
        // above could otherwise grant Admin, which carries the ConfigureSystem
        // an Owner is deliberately not granted.
        self.ensure_may_grant_role(actor_user_id, &role).await?;

        // See `write_user_role` — the lock, the last-admin check and the write
        // are one unit, and this was the writer that never took the lock.
        self.write_user_role(target_user_id, role, crate::WORKSPACE_ROOT_ID, false)
            .await?;

        // Handle metadata if provided
        if let Some(_metadata_bytes) = metadata {
            // TODO: Handle metadata updates when needed
        }

        Ok(())
    }

    async fn update_member_permissions(
        &self,
        actor_user_id: &str,
        target_user_id: &str,
        domain_id: &str,
        permissions: Vec<Permission>,
        operation: UpdateOperation,
    ) -> Result<(), NetworkError> {
        // Owner too, as for `update_workspace_member_role`.
        if !self.is_admin_or_owner(actor_user_id).await? {
            return Err(NetworkError::msg(
                "Permission denied: only an admin or the owner can manage permissions",
            ));
        }

        // Add and Set hand out authority; Remove only takes it away, so only
        // the granting operations are contained.
        if matches!(operation, UpdateOperation::Add | UpdateOperation::Set) {
            self.ensure_may_grant_permissions(actor_user_id, &permissions)
                .await?;
        }

        // Check if domain exists (workspace or DomainNode tree storage)
        let domain_exists = if domain_id == crate::WORKSPACE_ROOT_ID {
            self.backend_tx_manager
                .get_workspace(domain_id)
                .await?
                .is_some()
        } else {
            self.backend_tx_manager.get_node(domain_id).await?.is_some()
        };
        if !domain_exists {
            return Err(NetworkError::msg("Domain not found"));
        }

        // Get target user
        // The user record is read, modified and written back across awaits, so
        // it needs the same lock every other user writer takes. Two updates
        // landing together both read the same record, each applies its own
        // change to its own copy, and the second write discards the first --
        // silently, while reporting success to both callers.
        let _workspace_guard = self.backend_tx_manager.lock_workspaces().await;

        let mut user = match self.backend_tx_manager.get_user(target_user_id).await? {
            Some(u) => u,
            None => return Err(NetworkError::msg("User not found")),
        };

        // Update permissions
        use std::collections::HashSet;
        let perms = user
            .permissions
            .entry(domain_id.to_string())
            .or_insert_with(HashSet::new);

        match operation {
            UpdateOperation::Add => {
                for perm in permissions {
                    perms.insert(perm);
                }
            }
            UpdateOperation::Remove => {
                for perm in permissions {
                    perms.remove(&perm);
                }
            }
            UpdateOperation::Set => {
                perms.clear();
                for perm in permissions {
                    perms.insert(perm);
                }
            }
        }

        self.backend_tx_manager
            .insert_user(target_user_id.to_string(), user)
            .await?;
        Ok(())
    }

    async fn update_user_profile(
        &self,
        user_id: &str,
        name: Option<String>,
        avatar_data: Option<String>,
    ) -> Result<User, NetworkError> {
        // Get the user
        // The user record is read, modified and written back across awaits, so
        // it needs the same lock every other user writer takes. Two updates
        // landing together both read the same record, each applies its own
        // change to its own copy, and the second write discards the first --
        // silently, while reporting success to both callers.
        let _workspace_guard = self.backend_tx_manager.lock_workspaces().await;

        let mut user = match self.backend_tx_manager.get_user(user_id).await? {
            Some(u) => u,
            None => return Err(NetworkError::msg("User not found")),
        };

        // Update name if provided
        if let Some(new_name) = name {
            user.name = new_name;
        }

        // Update avatar if provided (store in metadata)
        if let Some(avatar) = avatar_data {
            use citadel_workspace_types::structs::MetadataValue;
            user.metadata
                .insert("avatar".to_string(), MetadataValue::String(avatar));
        }

        // Save the updated user
        self.backend_tx_manager
            .insert_user(user_id.to_string(), user.clone())
            .await?;

        Ok(user)
    }
}

// Continue with other trait implementations...
use std::future::Future;

// Implement remaining traits with placeholder implementations for now
#[async_trait]
impl<R: Ratchet + Send + Sync + 'static> AsyncEntityOperations<R>
    for AsyncDomainServerOperations<R>
{
    async fn get_domain_entity<T: DomainEntity + 'static + Send>(
        &self,
        _user_id: &str,
        _entity_id: &str,
    ) -> Result<T, NetworkError> {
        Err(NetworkError::msg("Not implemented yet"))
    }

    async fn create_domain_entity<
        T: DomainEntity + 'static + serde::de::DeserializeOwned + Send,
    >(
        &self,
        _user_id: &str,
        _parent_id: Option<&str>,
        _name: &str,
        _description: &str,
        _mdx_content: Option<&str>,
    ) -> Result<T, NetworkError> {
        Err(NetworkError::msg("Not implemented yet"))
    }

    async fn delete_domain_entity<T: DomainEntity + 'static + Send>(
        &self,
        _user_id: &str,
        _entity_id: &str,
    ) -> Result<T, NetworkError> {
        Err(NetworkError::msg("Not implemented yet"))
    }

    async fn update_domain_entity<T: DomainEntity + 'static + Send>(
        &self,
        _user_id: &str,
        _domain_id: &str,
        _name: Option<&str>,
        _description: Option<&str>,
        _mdx_content: Option<&str>,
    ) -> Result<T, NetworkError> {
        Err(NetworkError::msg("Not implemented yet"))
    }

    async fn list_domain_entities<T: DomainEntity + 'static + Send>(
        &self,
        _user_id: &str,
        _parent_id: Option<&str>,
    ) -> Result<Vec<T>, NetworkError> {
        Err(NetworkError::msg("Not implemented yet"))
    }
}

#[async_trait]
impl<R: Ratchet + Send + Sync + 'static> AsyncWorkspaceOperations<R>
    for AsyncDomainServerOperations<R>
{
    async fn get_workspace(
        &self,
        user_id: &str,
        workspace_id: &str,
    ) -> Result<Workspace, NetworkError> {
        // Check if user is member of workspace
        if !self.is_member_of_domain(user_id, workspace_id).await? {
            return Err(NetworkError::msg(
                crate::handlers::domain::workspace_errors::NOT_A_MEMBER,
            ));
        }

        // Get workspace from backend
        match self.backend_tx_manager.get_workspace(workspace_id).await? {
            Some(ws) => Ok(ws),
            None => Err(NetworkError::msg(
                crate::handlers::domain::workspace_errors::NO_SUCH_WORKSPACE,
            )),
        }
    }

    async fn get_workspace_details(
        &self,
        user_id: &str,
        ws_id: &str,
    ) -> Result<Workspace, NetworkError> {
        // Same as get_workspace for now
        self.get_workspace(user_id, ws_id).await
    }

    async fn create_workspace(
        &self,
        user_id: &str,
        name: &str,
        description: &str,
        metadata: Option<Vec<u8>>,
        workspace_master_password: String,
    ) -> Result<Workspace, NetworkError> {
        let root_exists = self
            .backend_tx_manager
            .get_domain(crate::WORKSPACE_ROOT_ID)
            .await?
            .is_some();

        // Determine workspace ID: use sentinel for first workspace, UUID for additional
        let workspace_id = if root_exists {
            // Creating a non-root workspace: verify against root workspace password
            let passwords = self.backend_tx_manager.get_all_passwords().await?;
            if !passwords
                .get(crate::WORKSPACE_ROOT_ID)
                .map(|p| p == &workspace_master_password)
                .unwrap_or(false)
            {
                return Err(NetworkError::msg("Invalid workspace master password"));
            }

            // Verify the creator has CreateWorkspace permission on the root workspace
            if !self
                .check_entity_permission(
                    user_id,
                    crate::WORKSPACE_ROOT_ID,
                    Permission::CreateWorkspace,
                )
                .await?
            {
                return Err(NetworkError::msg(
                    "Only root workspace admins can create additional workspaces",
                ));
            }

            uuid::Uuid::new_v4().to_string()
        } else {
            // First workspace: verify password against pre-seeded entry
            let passwords = self.backend_tx_manager.get_all_passwords().await?;
            if !passwords
                .get(crate::WORKSPACE_ROOT_ID)
                .map(|p| p == &workspace_master_password)
                .unwrap_or(false)
            {
                return Err(NetworkError::msg("Invalid workspace password"));
            }

            String::from(crate::WORKSPACE_ROOT_ID)
        };

        // Create workspace struct
        let mut workspace = Workspace {
            id: workspace_id.clone(),
            name: String::from(name),
            description: String::from(description),
            owner_id: String::from(user_id),
            members: vec![String::from(user_id)],
            offices: Vec::new(),
            metadata: Default::default(),
        };

        if let Some(meta_bytes) = metadata {
            workspace.metadata = meta_bytes;
        }

        // Save workspace
        self.backend_tx_manager
            .insert_workspace(workspace_id.clone(), workspace.clone())
            .await?;

        // Create domain entry
        let domain = Domain::Workspace {
            workspace: workspace.clone(),
        };
        self.backend_tx_manager
            .insert_domain(workspace_id.clone(), domain)
            .await?;

        // Save password for this workspace (same master password).
        //
        // Single-key write, deliberately. This used to snapshot the whole
        // password map and `save_passwords` it back, which re-wrote every
        // other workspace's password from a stale read — any password another
        // caller changed between our snapshot and our save would be silently
        // reverted. Only this workspace's key is ours to write.
        if !workspace_master_password.is_empty() {
            self.backend_tx_manager
                .set_workspace_password(&workspace_id, &workspace_master_password)
                .await?;
        }

        // Grant creator admin permissions
        // The user record is read, modified and written back across awaits, so
        // it needs the same lock every other user writer takes. Two updates
        // landing together both read the same record, each applies its own
        // change to its own copy, and the second write discards the first --
        // silently, while reporting success to both callers.
        let _workspace_guard = self.backend_tx_manager.lock_workspaces().await;

        let mut user = match self.backend_tx_manager.get_user(user_id).await? {
            Some(u) => u,
            None => User {
                id: String::from(user_id),
                name: String::from(user_id),
                // Only the bootstrap branch below promotes; an unknown account
                // cannot reach the other one, because `check_entity_permission`
                // returns false for a user that does not exist.
                role: UserRole::Member,
                permissions: Default::default(),
                metadata: Default::default(),
            },
        };

        if root_exists {
            // An ADDITIONAL workspace: full authority over the thing just
            // created, and nothing anywhere else.
            //
            // `user.role` is a single global field — `is_admin` reads it and
            // never asks which workspace — so setting it to Admin here made the
            // creator an administrator of the ROOT workspace too. An Owner holds
            // `CreateWorkspace`, so an Owner with the master password could
            // create a throwaway workspace and come back a global Admin,
            // carrying the `ConfigureSystem` that `for_role` withholds from
            // Owner. That is the escalation the role and permission doors were
            // closed against, arriving through a third one.
            user.permissions
                .insert(workspace_id.clone(), Permission::for_role(&UserRole::Admin));
        } else {
            // Bootstrap: there was no workspace until now, so this account IS
            // the administrator, globally and by definition.
            user.role = UserRole::Admin;
            user.set_role_permissions(&workspace_id);
        }

        self.backend_tx_manager
            .insert_user(String::from(user_id), user)
            .await?;

        Ok(workspace)
    }

    async fn delete_workspace(
        &self,
        user_id: &str,
        workspace_id: &str,
        workspace_master_password: String,
    ) -> Result<(), NetworkError> {
        // System Protection: Prevent deletion of the root workspace
        if workspace_id == crate::WORKSPACE_ROOT_ID {
            return Err(NetworkError::msg("Cannot delete the root workspace"));
        }

        // WHO is asking, not just what they know.
        //
        // The actor used to be discarded — the parameter was literally
        // `_user_id` — so the password below was the entire gate. And
        // `create_workspace` stores ROOT's master password against every
        // workspace it mints, so one shared secret authorised deleting any
        // non-root workspace, by any authenticated account, member or not.
        //
        // The password stays as a second factor; it is no longer the only one.
        // Owner as well as admin, because a workspace's owner is not
        // necessarily a global admin and deleting their own workspace is the
        // ordinary case.
        let is_admin = self.is_admin(user_id).await.unwrap_or(false);
        let is_owner = self
            .backend_tx_manager
            .get_workspace(workspace_id)
            .await
            .ok()
            .flatten()
            .map(|w| w.owner_id == user_id)
            .unwrap_or(false);
        if !is_admin && !is_owner {
            return Err(NetworkError::msg(
                "Permission denied: only an admin or the workspace owner may delete it",
            ));
        }

        // Verify master access password
        let passwords = self.backend_tx_manager.get_all_passwords().await?;
        if !passwords
            .get(workspace_id)
            .map(|p| p == &workspace_master_password)
            .unwrap_or(false)
        {
            return Err(NetworkError::msg(
                "Invalid workspace master access password",
            ));
        }

        // Remove workspace, domain, and password. `remove_workspace` deletes
        // the password key itself (with rollback if the index removal fails),
        // so nothing more is written here.
        //
        // There used to be a `passwords.remove(workspace_id)` +
        // `save_passwords(&passwords)` after this, and it deleted nothing:
        // `save_passwords` is upsert-only — a key omitted from the map is NOT
        // removed from the backend. All it actually did was re-write every
        // OTHER workspace's password from the stale snapshot taken for the
        // verification above, which could resurrect a password a concurrent
        // caller had deleted (or revert one it had changed) in the window
        // since that read.
        self.backend_tx_manager
            .remove_workspace(workspace_id)
            .await?;
        self.backend_tx_manager.remove_domain(workspace_id).await?;

        // Every member kept a `permissions[workspace_id]` entry for a workspace
        // that no longer exists. `remove_member` already does this for a single
        // domain (see its "Remove permissions from user" block); deleting the
        // whole workspace did not, so the entries accumulated -- unreachable,
        // since ids are server-minted UUIDs and can never be reissued, but
        // unbounded across deletions.
        //
        // Done AFTER the workspace is gone, deliberately. If this fails the
        // leftover is the same unreachable garbage we are cleaning up; doing it
        // first would mean a failed `remove_workspace` had already stripped
        // every member's access to a workspace that still exists.
        //
        // Per user rather than one `save_users`, matching `remove_member`: a
        // read-modify-write of the whole map would clobber concurrent user
        // edits, which is exactly the bug the `lock_nodes` comment above records.
        //
        // Under `lock_workspaces` for the same reason `create_workspace` takes
        // it around its own get_user/insert_user pair: a user record read,
        // modified and written back across awaits needs the lock every other
        // user writer takes, or two updates each apply to their own copy and the
        // second write silently discards the first. Safe to take here -- the
        // lock is only ever held by this handler layer, never inside
        // `remove_workspace` or `insert_user`.
        let _workspace_guard = self.backend_tx_manager.lock_workspaces().await;
        let users = self.backend_tx_manager.get_all_users().await?;
        let holders: Vec<String> = users
            .iter()
            .filter(|(_, user)| user.permissions.contains_key(workspace_id))
            .map(|(id, _)| id.clone())
            .collect();
        for holder in holders {
            if let Some(mut user) = self.backend_tx_manager.get_user(&holder).await? {
                if user.permissions.remove(workspace_id).is_some() {
                    self.backend_tx_manager.insert_user(holder, user).await?;
                }
            }
        }

        Ok(())
    }

    async fn update_workspace(
        &self,
        user_id: &str,
        workspace_id: &str,
        name: Option<&str>,
        description: Option<&str>,
        metadata: Option<Vec<u8>>,
        workspace_master_password: String,
    ) -> Result<Workspace, NetworkError> {
        // Verify master access password
        let passwords = self.backend_tx_manager.get_all_passwords().await?;
        if !passwords
            .get(workspace_id)
            .map(|p| p == &workspace_master_password)
            .unwrap_or(false)
        {
            return Err(NetworkError::msg(
                "Invalid workspace master access password",
            ));
        }

        // Held across the whole read-modify-write, like the connect path.
        //
        // A mutex only excludes PARTICIPANTS. The connect-time member-add takes
        // this lock, but that bought nothing while this function did not: it
        // reads the record whole, appends the caller to `members`, and writes it
        // back — so it could read `[user1]`, and write `[user1]` over the
        // `[user1, user2]` that the connect path had just written under the
        // lock. user2's membership vanishes, and `get_workspace` then refuses
        // them with "Not a member", which the command processor maps to
        // WorkspaceNotInitialized — so their client re-shows the setup flow.
        //
        // Same first-run window the connect-side fix targeted; that fix was only
        // half of it.
        let _workspace_guard = self.backend_tx_manager.lock_workspaces().await;

        // Get workspace directly from backend without permission check
        // since we've verified the master password
        let mut workspace = match self.backend_tx_manager.get_workspace(workspace_id).await? {
            Some(ws) => ws,
            None => return Err(NetworkError::msg("Workspace not found")),
        };

        // The bootstrap must not stay open once it has been used.
        //
        // An unowned workspace is claimable by whoever presents the master
        // password: that is the documented way the first admin is established
        // (see UNASSIGNED_OWNER), and the seeded root workspace starts that way.
        // Once someone has claimed it, though, the password stops being
        // sufficient -- because it is not a per-workspace secret. Creating any
        // non-root workspace requires ROOT's password and then stores that same
        // value as the new workspace's own, so the one secret is held by
        // everyone who has ever created a workspace. Without this check any
        // authenticated holder of it could add themselves to a workspace they
        // are not in, rewrite its name and metadata, and -- via the role write
        // at the end of this function -- promote themselves to Admin.
        //
        // `delete_workspace` was given exactly this treatment, and says so in
        // its own comment; this was its unguarded twin.
        let is_bootstrap = workspace.owner_id.is_empty();
        if !is_bootstrap {
            let is_admin = self.is_admin(user_id).await.unwrap_or(false);
            let is_owner = workspace.owner_id == user_id;
            if !is_admin && !is_owner {
                return Err(NetworkError::msg(
                    "Permission denied: only an admin or the workspace owner may update it",
                ));
            }
        }

        // Update fields
        if let Some(new_name) = name {
            workspace.name = new_name.to_string();
        }
        if let Some(new_desc) = description {
            workspace.description = new_desc.to_string();
        }
        if let Some(meta_bytes) = metadata {
            // Merge, do not replace. `metadata` is one JSON object shared by
            // several features: this path writes {"initialized": true} while
            // theming writes a `theme` key. Assigning over the top erased any
            // theme configured before the workspace was initialised — the same
            // defect already fixed on the theme path, which this call site
            // never received.
            workspace.metadata =
                super::metadata_merge::merge_metadata_document(&workspace.metadata, &meta_bytes)
                    .map_err(NetworkError::msg)?;
        }

        // Membership follows from the claim, not from the password. Anyone
        // reaching here who is not bootstrapping is already the owner or an
        // admin, so this only ever adds the claimant.
        if is_bootstrap && !workspace.members.contains(&user_id.to_string()) {
            workspace.members.push(user_id.to_string());
        }

        // If workspace has no owner, the first user with master password becomes the owner
        if is_bootstrap {
            info!(target: "citadel", "No owner set - assigning {} as workspace owner", user_id);
            workspace.owner_id = user_id.to_string();
        }

        // Save updated workspace
        self.backend_tx_manager
            .insert_workspace(workspace_id.to_string(), workspace.clone())
            .await?;

        // Update domain
        let domain = Domain::Workspace {
            workspace: workspace.clone(),
        };
        self.backend_tx_manager
            .insert_domain(workspace_id.to_string(), domain)
            .await?;

        // Granting Admin is part of claiming an unowned workspace, and only that.
        //
        // It has to happen here rather than through add_user_to_domain, because
        // during initialisation there is no admin yet to authorise it. That is
        // precisely why it must not run afterwards: once the workspace has an
        // owner, this write would hand Admin to anyone who presented the shared
        // master password. Renaming a workspace is not a reason to change
        // anybody's role, so a later owner/admin edit leaves roles untouched.
        if !is_bootstrap {
            return Ok(workspace);
        }

        // We need to directly update the user's role since add_user_to_domain requires admin permissions
        // but there might not be any admins yet during workspace initialization
        let mut user = match self.backend_tx_manager.get_user(user_id).await? {
            Some(u) => u,
            None => {
                // Create user if doesn't exist (shouldn't happen but handle it)
                User {
                    id: user_id.to_string(),
                    name: user_id.to_string(),
                    role: UserRole::Admin,
                    permissions: Default::default(),
                    metadata: Default::default(),
                }
            }
        };

        // Set user role to Admin
        user.role = UserRole::Admin;

        // Set permissions for this workspace using the role
        user.set_role_permissions(workspace_id);

        // Save updated user
        self.backend_tx_manager
            .insert_user(user_id.to_string(), user)
            .await?;

        Ok(workspace)
    }

    async fn load_workspace(
        &self,
        user_id: &str,
        workspace_id_opt: Option<&str>,
    ) -> Result<Workspace, NetworkError> {
        if let Some(workspace_id) = workspace_id_opt {
            // Load specific workspace
            self.get_workspace(user_id, workspace_id).await
        } else {
            // Load primary workspace for user
            let user = match self.backend_tx_manager.get_user(user_id).await? {
                Some(u) => u,
                None => return Err(NetworkError::msg("User not found")),
            };

            // Check for primary_workspace_id in metadata
            if let Some(citadel_workspace_types::structs::MetadataValue::String(primary_ws_id)) =
                user.metadata.get("primary_workspace_id")
            {
                self.get_workspace(user_id, primary_ws_id).await
            } else {
                // Find first workspace user is member of
                let workspaces = self.list_workspaces(user_id).await?;
                workspaces
                    .into_iter()
                    .next()
                    .ok_or_else(|| NetworkError::msg("No workspace found for user"))
            }
        }
    }

    async fn list_workspaces(&self, user_id: &str) -> Result<Vec<Workspace>, NetworkError> {
        let all_workspaces = self.backend_tx_manager.get_all_workspaces().await?;

        let mut accessible_workspaces = Vec::new();
        for (ws_id, workspace) in all_workspaces {
            if self.is_member_of_domain(user_id, &ws_id).await? {
                accessible_workspaces.push(workspace);
            }
        }

        Ok(accessible_workspaces)
    }

    async fn get_all_workspace_ids(&self) -> Result<WorkspaceDBList, NetworkError> {
        let workspaces = self.backend_tx_manager.get_all_workspaces().await?;
        let workspace_ids: Vec<String> = workspaces.keys().cloned().collect();
        Ok(WorkspaceDBList {
            workspaces: workspace_ids,
        })
    }

    async fn add_office_to_workspace(
        &self,
        user_id: &str,
        workspace_id: &str,
        office_id: &str,
    ) -> Result<(), NetworkError> {
        // Check permission - need CreateNode permission
        if !self
            .check_entity_permission(user_id, workspace_id, Permission::CreateNode)
            .await?
        {
            return Err(NetworkError::msg("Permission denied: Cannot create office"));
        }

        // Get and update workspace
        let mut workspace = self.get_workspace(user_id, workspace_id).await?;
        if !workspace.offices.contains(&office_id.to_string()) {
            workspace.offices.push(office_id.to_string());

            // Save updated workspace
            self.backend_tx_manager
                .insert_workspace(workspace_id.to_string(), workspace.clone())
                .await?;

            // Update domain
            let domain = Domain::Workspace { workspace };
            self.backend_tx_manager
                .insert_domain(workspace_id.to_string(), domain)
                .await?;
        }

        Ok(())
    }

    async fn remove_office_from_workspace(
        &self,
        user_id: &str,
        workspace_id: &str,
        office_id: &str,
    ) -> Result<(), NetworkError> {
        // Check permission - need DeleteNode permission
        if !self
            .check_entity_permission(user_id, workspace_id, Permission::DeleteNode)
            .await?
        {
            return Err(NetworkError::msg("Permission denied: Cannot delete office"));
        }

        // Get and update workspace
        let mut workspace = self.get_workspace(user_id, workspace_id).await?;
        workspace.offices.retain(|o| o != office_id);

        // Save updated workspace
        self.backend_tx_manager
            .insert_workspace(workspace_id.to_string(), workspace.clone())
            .await?;

        // Update domain
        let domain = Domain::Workspace { workspace };
        self.backend_tx_manager
            .insert_domain(workspace_id.to_string(), domain)
            .await?;

        Ok(())
    }

    async fn add_user_to_workspace(
        &self,
        user_id: &str,
        workspace_id: &str,
        member_id: &str,
        role: UserRole,
    ) -> Result<(), NetworkError> {
        // Delegate to add_user_to_domain
        self.add_user_to_domain(user_id, member_id, workspace_id, role)
            .await
    }

    async fn remove_user_from_workspace(
        &self,
        user_id: &str,
        workspace_id: &str,
        member_id: &str,
    ) -> Result<(), NetworkError> {
        // Delegate to remove_user_from_domain
        self.remove_user_from_domain(user_id, member_id, workspace_id)
            .await
    }
}

// Implement the complete trait
impl<R: Ratchet + Send + Sync + 'static> AsyncCompleteDomainOperations<R>
    for AsyncDomainServerOperations<R>
{
}
