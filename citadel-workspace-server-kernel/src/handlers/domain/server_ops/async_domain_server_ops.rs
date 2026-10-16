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
use citadel_workspace_types::roles::{owner_role, OWNER_ROLE_ID};
use citadel_workspace_types::roles_protocol::MemberRole;
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
        // There is no administrator short-circuit. An Admin passes because the admin role holds
        // the `All` wildcard, inside the workspace whose role it is; the short-circuit that was
        // here read a global enum, so it also passed in workspaces the Admin did not belong to.
        let user = match self.backend_tx_manager.get_user(user_id).await? {
            Some(u) => u,
            None => return Ok(false),
        };
        // A standing, not a role: a banned account holds nothing anywhere.
        if user.is_banned() {
            return Ok(false);
        }

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
        let nodes = self.backend_tx_manager.get_all_nodes_shared().await?;
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

        // Membership in a domain confers the permissions of the user's ROLE in the workspace
        // the domain belongs to.
        //
        // Membership once conferred exactly one permission, ViewContent, and consulted the
        // role for nothing, so a plain member could read an office and never post to it.
        // Scoped to membership of THIS domain, which a member of the workspace has throughout
        // it, and to that workspace's table: a role in one workspace confers nothing in another.
        let Some(workspace_id) = self.workspace_of(entity_id, &nodes).await? else {
            return Ok(false);
        };
        if !self.is_member_of_domain(user_id, entity_id).await? {
            return Ok(false);
        }
        Ok(self
            .role_in_table(&workspace_id, &user)
            .await?
            .is_some_and(|role| role.grants(permission)))
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
        let nodes = self.backend_tx_manager.get_all_nodes_shared().await?;
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
        role: MemberRole,
    ) -> Result<(), NetworkError> {
        // Asked as the permission, not as the role, so the gate is what
        // `GetUserPermissions` reports: any role holding AddUsers, within the
        // workspace whose role it is.
        if !self
            .check_entity_permission(admin_id, domain_id, Permission::AddUsers)
            .await?
        {
            return Err(NetworkError::msg(
                "Permission denied: AddUsers is required to manage members",
            ));
        }

        // Only a registered account may be admitted. Everything below mints a
        // `User` for a name it has never seen, so a typo in the dialog became a
        // phantom member with a role. Asked after AddUsers, so the refusal does
        // not tell an unprivileged caller which usernames exist.
        if !self
            .backend_tx_manager
            .account_is_registered(user_id_to_add)
            .await?
        {
            return Err(NetworkError::msg(format!(
                "No account named '{user_id_to_add}' exists on this workspace"
            )));
        }

        // AddUsers says they may add somebody; it says nothing about the role
        // they may hand out, and `user_id_to_add` may be the caller.
        let assignment = self.resolve_assignment(&role).await?;
        self.ensure_may_grant_role(admin_id, &assignment).await?;

        // `AddMember` is also a role WRITE at the workspace root, so it is the
        // third door to the same demotion: `role: Banned` on a standing Admin
        // passes the granting check (Banned grants nothing) and would otherwise
        // strip them.
        self.ensure_may_act_on(admin_id, user_id_to_add, "change the role of")
            .await?;

        // If this is the workspace root, use the workspace storage
        // Held across BOTH writes: the membership below and the role at the end.
        //
        // Same lock as the connect path and update_workspace — the root branch
        // reads the workspace whole and writes it back, so without it those
        // fixes only exclude each other. But it was scoped to that branch, and
        // `write_user_role` then took the lock again for the role. A removal
        // landing between the two left a non-member holding a role, which the
        // guard that counts managers among `workspace.members` cannot see.
        //
        // Taken here rather than in the branch so the non-root path gets the
        // same atomicity — it writes a role too.
        let _workspace_guard = self.backend_tx_manager.lock_workspaces().await;

        if domain_id == crate::WORKSPACE_ROOT_ID {
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

        // Role write and last-admin check, under the SAME guard as the
        // membership write above — `_locked`, because `tokio::sync::Mutex` is
        // not reentrant and `write_user_role` would deadlock on the guard we are
        // still holding.
        self.write_user_role_locked(user_id_to_add, &assignment, domain_id, true)
            .await?;

        Ok(())
    }

    async fn remove_user_from_domain(
        &self,
        admin_id: &str,
        user_id_to_remove: &str,
        domain_id: &str,
    ) -> Result<(), NetworkError> {
        // Asked as the permission, not as the role, so the gate is what
        // `GetUserPermissions` reports: any role holding RemoveUsers.
        if !self
            .check_entity_permission(admin_id, domain_id, Permission::RemoveUsers)
            .await?
        {
            return Err(NetworkError::msg(
                "Permission denied: RemoveUsers is required to manage members",
            ));
        }

        // Who may act on whom is not a property of the STORAGE the domain lives
        // in, so it is checked before the branch that selects one.
        //
        // This call sat inside the root branch only, so every office and room
        // went through `RemoveUsers` alone. Any role may be given that, so its
        // holder could remove the Owner from any office or room,
        // while the identical request against the workspace root refused with
        // "cannot remove ..., who is above them". `add_user_to_domain` already
        // does it this way, and its own comment says why -- "taken here rather
        // than in the branch so the non-root path gets the same" treatment.
        //
        // Only the CHECK is hoisted, not the workspace lock. That lock cannot
        // move: `lock_workspaces()` is taken again after both branches for the
        // permissions cleanup, tokio's Mutex is not reentrant, and the comment
        // there depends on the branch guards having dropped. Hoisting the lock
        // deadlocks the whole handler.
        //
        // The root branch still repeats this check inside its lock. That is not
        // redundancy for its own sake: this call answers "may you act on them
        // at all", and the in-lock one answers it again against the state the
        // write will actually use, which is what stops a concurrent promotion
        // landing between the check and the write.
        self.ensure_may_act_on(admin_id, user_id_to_remove, "remove")
            .await?;

        // The root branch always removes someone listed there; the node branch
        // records whether they were, for the check after the grant cleanup.
        let mut listed_here = true;
        // If this is the workspace root, use the workspace storage
        if domain_id == crate::WORKSPACE_ROOT_ID {
            // BEFORE the managers check, not after.
            //
            // `ensure_managers_remain` counts and returns; the write happens
            // separately. Two managers removing each other both counted 2, both
            // passed, and both writes landed — leaving nobody able to assign a
            // role, which is unrecoverable.
            //
            // Holding the lock across check AND write is what makes the guard
            // mean anything. It also covers the workspace read-modify-write
            // below, which is the same erased-member race the connect path and
            // update_workspace take this lock for.
            let _workspace_guard = self.backend_tx_manager.lock_workspaces().await;

            // Inside the lock, beside the last-admin check, for the same
            // reason: the target's role is what both read, and a concurrent
            // promotion between the two would answer from different states.
            self.ensure_may_act_on(admin_id, user_id_to_remove, "remove")
                .await?;

            self.ensure_managers_remain(user_id_to_remove, None, "remove")
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

            // Ban, as well as unlist, EVERY removed user.
            //
            // Unlisting alone recorded nothing: the connect handler enrols
            // anyone missing from `workspace.members`, and could not tell
            // "never joined" from "removed", so a removed account reconnected
            // -- which it does by itself -- and added itself straight back.
            // Re-admission is `AddMember`, which assigns an explicit role.
            //
            // `assign_workspace_role` with Banned also drops the role and clears
            // every grant, not only the root one: a direct grant is honoured
            // before the role, so a member added to room R and then removed
            // would otherwise go on reading and posting in R.
            //
            // Not through `write_user_role_locked`: that re-runs the managers
            // guard, and the membership write above has already removed this
            // account, so the count differs and the removal would be refused.
            if let Some(mut removed) = self.backend_tx_manager.get_user(user_id_to_remove).await? {
                super::role_writes::assign_workspace_role(
                    &mut removed,
                    &super::role_authority::Assignment::Banned,
                );
                self.backend_tx_manager
                    .insert_user(user_id_to_remove.to_string(), removed)
                    .await?;
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
            listed_here = node.members.iter().any(|m| m == user_id_to_remove);
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
        let mut had_grant_here = false;
        if let Some(mut user) = self.backend_tx_manager.get_user(user_id_to_remove).await? {
            had_grant_here = user.permissions.remove(domain_id).is_some();
            self.backend_tx_manager
                .insert_user(user_id_to_remove.to_string(), user)
                .await?;
        }

        // Neither listed on this node nor granted anything on it: their access
        // comes from a level above, which this removal cannot touch. Rosters now
        // list such people (kernel/roster.rs), so "removed" here would report a
        // change that did not happen -- they would still be in the room.
        if !listed_here && !had_grant_here {
            return Err(NetworkError::msg(format!(
                "{user_id_to_remove} has access here through a level above, not as a member of this one; manage them there"
            )));
        }

        Ok(())
    }

    async fn update_workspace_member_role(
        &self,
        actor_user_id: &str,
        target_user_id: &str,
        role: MemberRole,
        metadata: Option<Vec<u8>>,
    ) -> Result<(), NetworkError> {
        // Assigning roles is role management: ManageRoles, which the Owner and
        // the admin role hold, and which an admin may give a role below theirs.
        if !self
            .holds_workspace_permission(actor_user_id, Permission::ManageRoles)
            .await?
        {
            return Err(NetworkError::msg(
                "Permission denied: ManageRoles is required to change a member's role",
            ));
        }

        // The gate says they may assign roles; this says which.
        let assignment = self.resolve_assignment(&role).await?;
        self.ensure_may_grant_role(actor_user_id, &assignment)
            .await?;

        // And the other direction: what the target currently holds.
        self.ensure_may_act_on(actor_user_id, target_user_id, "change the role of")
            .await?;

        // See `write_user_role` — the lock, the managers check and the write
        // are one unit, and this was the writer that never took the lock.
        self.write_user_role(target_user_id, &assignment, crate::WORKSPACE_ROOT_ID, false)
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
        // A member's grants are role management too, as for
        // `update_workspace_member_role`.
        if !self
            .holds_workspace_permission(actor_user_id, Permission::ManageRoles)
            .await?
        {
            return Err(NetworkError::msg(
                "Permission denied: ManageRoles is required to change a member's permissions",
            ));
        }

        // Add and Set hand out authority; Remove only takes it away, so only
        // the granting operations are contained.
        if matches!(operation, UpdateOperation::Add | UpdateOperation::Set) {
            self.ensure_may_grant_permissions(actor_user_id, &permissions)
                .await?;
        }

        // And the other direction, which was open here alone. The three doors
        // `no_one_unseats_a_role_above_their_own` closed all write a ROLE;
        // this one writes the permission map, and the entry gate above admits
        // any role with ManageRoles. So an Admin could not demote or ban the Owner, and could
        // `Set` the Owner's grants to nothing -- Remove is not even contained
        // by the granting check, because taking away grants nothing.
        //
        // The role's own permissions survive a stripped map (see
        // `check_entity_permission`, which falls through to the member's role
        // in the workspace), so this does not
        // strand the Owner in the root workspace. What it does take is every
        // EXPLICIT grant -- including access to a node the Owner holds by grant
        // rather than by membership, and any `Permission::All` written there.
        // That is unseating by another door, and it belongs behind the same
        // rule as the other three.
        self.ensure_may_act_on(actor_user_id, target_user_id, "change the permissions of")
            .await?;

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
        update: crate::kernel::profile_update::ProfileUpdate,
    ) -> Result<User, NetworkError> {
        crate::kernel::profile_limits::check_profile_update(&update)?;
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

        crate::kernel::profile_update::apply_profile_update(&mut user, update);

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

        // Membership is not enough on its own: banning changes a ROLE and leaves
        // the member list untouched, so a banned account went on reading the
        // workspace name, description, metadata and office list. Setting a role
        // to Banned is an available operation — `update_workspace_member_role`
        // takes any UserRole, and containment permits it because Banned's
        // permission set is empty — so this is reachable, not theoretical.
        //
        // Asked as the permission rather than as `role != Banned`, for the reason
        // `remove_user_from_domain` records: what `GetUserPermissions` reports
        // must be what enforcement allows. `for_role` gives Banned nothing and
        // gives Guest `ViewContent`, so this refuses exactly the accounts the
        // permission editor already shows as unable to view.
        if !self
            .check_entity_permission(user_id, workspace_id, Permission::ViewContent)
            .await?
        {
            return Err(NetworkError::msg(
                "Permission denied: ViewContent is required to read this workspace",
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
            // Authorization FIRST, then the password -- the same order, and for the
            // same reason, as `update_workspace` below.
            //
            // These two blocks were the other way round, so every account on the
            // server had a permanent yes/no oracle on the root master password:
            // send a CreateWorkspace with a guess and read which of two distinct
            // errors comes back. "Invalid workspace master password" means the
            // guess was wrong; "Only root workspace admins can create additional
            // workspaces" means the guess was RIGHT and only the caller was wrong.
            // With open enrolment that is available to anyone who can register,
            // and the rate limiter is per CID (100/s), so the guess rate scales
            // with the number of accounts an attacker creates.
            //
            // Making the comparison constant-time did nothing about this: the
            // answer was being returned as text. Ordered this way, a caller
            // without CreateWorkspace is refused identically whatever they send.
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

            // Creating a non-root workspace: verify against root workspace password
            let passwords = self.backend_tx_manager.get_all_passwords().await?;
            if !passwords
                .get(crate::WORKSPACE_ROOT_ID)
                .map(|p| crate::kernel::secret_eq::secrets_match(p, &workspace_master_password))
                .unwrap_or(false)
            {
                return Err(NetworkError::msg("Invalid workspace master password"));
            }

            uuid::Uuid::new_v4().to_string()
        } else {
            // First workspace: verify password against pre-seeded entry
            let passwords = self.backend_tx_manager.get_all_passwords().await?;
            if !passwords
                .get(crate::WORKSPACE_ROOT_ID)
                .map(|p| crate::kernel::secret_eq::secrets_match(p, &workspace_master_password))
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
            // Only the bootstrap branch below assigns a root role; an unknown
            // account cannot reach the other one, because
            // `check_entity_permission` returns false for a user that does not
            // exist.
            None => User::new(
                String::from(user_id),
                String::from(user_id),
                UserRole::Member,
            ),
        };

        if root_exists {
            // An ADDITIONAL workspace: its Owner, and nothing anywhere else.
            //
            // A role belongs to one workspace's table, so this confers nothing
            // in the root. The old global role did: making the creator an Admin
            // here made them an Admin of the root too, so an Owner with the
            // master password could create a throwaway workspace and come back
            // holding `All`.
            user.workspace_roles
                .insert(workspace_id.clone(), OWNER_ROLE_ID.to_string());
        } else {
            // Bootstrap: there was no workspace until now, so this account IS
            // the Owner, by definition. Owner rather than Admin because nobody
            // assigns a role at or above their own: an Admin alone could never
            // appoint another, while the Owner is above the ladder.
            super::role_writes::assign_workspace_role(
                &mut user,
                &super::role_authority::Assignment::Role(owner_role()),
            );
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
        // DeleteWorkspace across the root workspace: what the global Admin
        // check meant, asked as the permission, so the Owner and any role given
        // it qualify.
        let is_admin = self
            .holds_workspace_permission(user_id, Permission::DeleteWorkspace)
            .await?;
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

        // Taken here, before the password is verified and the workspace is
        // removed — not further down where the user-permission sweep needed it.
        //
        // `remove_workspace` ran outside every lock, so a concurrent WRITER that
        // had already read this workspace under `lock_workspaces` — a theme
        // update, a member add — wrote its copy back afterwards and RESURRECTED
        // the record. The password key is genuinely gone by then, so the
        // resurrected workspace can never be deleted again: `delete_workspace`
        // refuses without a matching password and there is none to match. A
        // permanently undeletable workspace, from an ordinary edit landing in
        // the wrong microsecond.
        //
        // Holding it from here also makes the password check and the delete one
        // decision rather than two, so a password changed between them cannot
        // authorise a deletion it no longer permits.
        //
        // Safe to hold across all of it: the lock is only ever taken by this
        // handler layer, never inside `remove_workspace` or `insert_user`.
        let _workspace_guard = self.backend_tx_manager.lock_workspaces().await;

        // Verify master access password
        let passwords = self.backend_tx_manager.get_all_passwords().await?;
        if !passwords
            .get(workspace_id)
            .map(|p| crate::kernel::secret_eq::secrets_match(p, &workspace_master_password))
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
        // Still under `_workspace_guard`, for the same reason `create_workspace`
        // takes it around its own get_user/insert_user pair: a user record read,
        // modified and written back across awaits needs the lock every other
        // user writer takes, or two updates each apply to their own copy and the
        // second write silently discards the first.
        //
        // The role a member held there goes the same way: it names a table that
        // no longer exists.
        let users = self.backend_tx_manager.get_all_users().await?;
        let holders: Vec<String> = users
            .iter()
            .filter(|(_, user)| {
                user.permissions.contains_key(workspace_id)
                    || user.workspace_roles.contains_key(workspace_id)
            })
            .map(|(id, _)| id.clone())
            .collect();
        for holder in holders {
            if let Some(mut user) = self.backend_tx_manager.get_user(&holder).await? {
                let granted = user.permissions.remove(workspace_id).is_some();
                let held = user.workspace_roles.remove(workspace_id).is_some();
                if granted || held {
                    self.backend_tx_manager.insert_user(holder, user).await?;
                }
            }
        }
        self.backend_tx_manager.delete_roles(workspace_id).await?;

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
            // UpdateWorkspace across the root workspace, as `delete_workspace`
            // asks DeleteWorkspace.
            let is_admin = self
                .holds_workspace_permission(user_id, Permission::UpdateWorkspace)
                .await?;
            let is_owner = workspace.owner_id == user_id;
            if !is_admin && !is_owner {
                return Err(NetworkError::msg(
                    "Permission denied: only an admin or the workspace owner may update it",
                ));
            }
        }

        // Password check AFTER authorization, deliberately.
        //
        // It used to run first, before anything looked at who was asking. So
        // every account on the server -- and with open enrolment that is anyone
        // who can register -- had a permanent yes/no oracle on the master
        // password: send an UpdateWorkspace with a guess and read which of two
        // distinct errors comes back. "Invalid workspace master access
        // password" means wrong guess; "Permission denied" means right guess,
        // wrong caller. The rate limiter is per CID (100/s), so with free
        // accounts the guess rate scales with the number of accounts created.
        //
        // Ordered this way, a caller who is neither owner nor admin is refused
        // identically whatever they send, and learns nothing.
        //
        // For a BOOTSTRAP workspace the password IS the authorization -- that
        // is the documented way the first owner claims an unowned workspace --
        // so the oracle is inherent there. It is bounded by the operator
        // claiming, which is what the claim flow is for.
        let passwords = self.backend_tx_manager.get_all_passwords().await?;
        if !passwords
            .get(workspace_id)
            .map(|p| crate::kernel::secret_eq::secrets_match(p, &workspace_master_password))
            .unwrap_or(false)
        {
            return Err(NetworkError::msg(
                "Invalid workspace master access password",
            ));
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

        // Becoming the Owner is part of claiming an unowned workspace, and only
        // that.
        //
        // It has to happen here rather than through add_user_to_domain, because
        // during initialisation there is nobody yet to authorise it. That is
        // precisely why it must not run afterwards: once the workspace has an
        // owner, this write would hand the seat to anyone who presented the
        // shared master password. Renaming a workspace is not a reason to change
        // anybody's role, so a later edit leaves roles untouched.
        //
        // Owner, not Admin, for the reason `create_workspace` gives: an Admin
        // alone could never appoint a second, since nobody assigns their own
        // position.
        if !is_bootstrap {
            return Ok(workspace);
        }

        let mut user = match self.backend_tx_manager.get_user(user_id).await? {
            Some(u) => u,
            None => User::new(user_id.to_string(), user_id.to_string(), UserRole::Member),
        };
        if workspace_id == crate::WORKSPACE_ROOT_ID {
            super::role_writes::assign_workspace_role(
                &mut user,
                &super::role_authority::Assignment::Role(owner_role()),
            );
        } else {
            user.workspace_roles
                .insert(workspace_id.to_string(), OWNER_ROLE_ID.to_string());
        }

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

        // Membership AND ViewContent, matching `get_workspace`.
        //
        // This filtered on membership alone, and banning changes a ROLE while
        // leaving `workspace.members` untouched. So `GetWorkspace` answered
        // "ViewContent is required to read this workspace" while `ListWorkspaces`
        // handed the same banned account the same record — name, description,
        // owner, member count — for every workspace it was still listed in. The
        // gate was added to one endpoint and not to its sibling, which is the
        // shape this campaign keeps finding.
        let mut accessible_workspaces = Vec::new();
        for (ws_id, workspace) in all_workspaces {
            if self.is_member_of_domain(user_id, &ws_id).await?
                && self
                    .check_entity_permission(user_id, &ws_id, Permission::ViewContent)
                    .await?
            {
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
        role: MemberRole,
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
