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
    /// Refuse anything that would leave the workspace with no administrator.
    ///
    /// Demoting or removing the last Admin is unrecoverable: promotion requires
    /// an admin, so there is no way back from a workspace that has none. The
    /// admin UI offers both actions on the acting user's own row, which puts
    /// that state one click away — and it is exactly the state that made the
    /// product read-only for everyone before joining users were promoted.
    ///
    /// A no-op when the target is not an Admin, so ordinary member management is
    /// unaffected.
    async fn ensure_not_last_admin(
        &self,
        target_user_id: &str,
        action: &str,
    ) -> Result<(), NetworkError> {
        let target = match self.backend_tx_manager.get_user(target_user_id).await? {
            Some(user) => user,
            None => return Ok(()),
        };
        if target.role != UserRole::Admin {
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

        let mut admins = 0usize;
        for member_id in &workspace.members {
            if let Some(member) = self.backend_tx_manager.get_user(member_id).await? {
                if member.role == UserRole::Admin {
                    admins += 1;
                }
            }
        }

        if admins <= 1 {
            return Err(NetworkError::msg(format!(
                "Cannot {action} the only administrator. Promote another member to Admin first —                  otherwise nobody could manage the workspace, and the change cannot be undone."
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
        if let Some(node) = self.backend_tx_manager.get_node(entity_id).await? {
            let mut current_parent = node.parent_id.clone();
            while let Some(pid) = current_parent {
                if let Some(parent_perms) = user.permissions.get(&pid) {
                    if parent_perms.contains(&permission) || parent_perms.contains(&Permission::All)
                    {
                        return Ok(true);
                    }
                }
                // Continue up the tree
                if let Some(parent_node) = self.backend_tx_manager.get_node(&pid).await? {
                    current_parent = parent_node.parent_id.clone();
                } else {
                    break;
                }
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

        // For all other entities, use DomainNode tree storage
        if let Some(node) = self.backend_tx_manager.get_node(domain_id).await? {
            if node.members.contains(&user_id.to_string()) {
                return Ok(true);
            }
            // Check parent for inheritance
            if let Some(parent_id) = &node.parent_id {
                return self.is_member_of_domain(user_id, parent_id).await;
            }
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
        // Check permissions - admins can manage members
        if !self.is_admin(admin_id).await? {
            return Err(NetworkError::msg(
                "Permission denied: Only admins can manage members",
            ));
        }

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
        // Check permissions - admins can manage members
        if !self.is_admin(admin_id).await? {
            return Err(NetworkError::msg(
                "Permission denied: Only admins can manage members",
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

        // Remove permissions from user
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
        // Check if actor has admin permission
        if !self.is_admin(actor_user_id).await? {
            return Err(NetworkError::msg(
                "Permission denied: Only admins can update member roles",
            ));
        }

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
        // Check if actor has permission to manage members - only admins
        if !self.is_admin(actor_user_id).await? {
            return Err(NetworkError::msg(
                "Permission denied: Only admins can manage permissions",
            ));
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

        // Save password for this workspace (same master password)
        if !workspace_master_password.is_empty() {
            let mut passwords = self.backend_tx_manager.get_all_passwords().await?;
            passwords.insert(workspace_id.clone(), workspace_master_password);
            self.backend_tx_manager.save_passwords(&passwords).await?;
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
                role: UserRole::Admin,
                permissions: Default::default(),
                metadata: Default::default(),
            },
        };

        user.role = UserRole::Admin;
        user.set_role_permissions(&workspace_id);

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
        let mut passwords = self.backend_tx_manager.get_all_passwords().await?;
        if !passwords
            .get(workspace_id)
            .map(|p| p == &workspace_master_password)
            .unwrap_or(false)
        {
            return Err(NetworkError::msg(
                "Invalid workspace master access password",
            ));
        }

        // Remove workspace, domain, and password
        self.backend_tx_manager
            .remove_workspace(workspace_id)
            .await?;
        self.backend_tx_manager.remove_domain(workspace_id).await?;

        passwords.remove(workspace_id);
        self.backend_tx_manager.save_passwords(&passwords).await?;

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

        // Add the user as a member if they're not already (since they have the master password)
        if !workspace.members.contains(&user_id.to_string()) {
            workspace.members.push(user_id.to_string());
        }

        // If workspace has no owner, the first user with master password becomes the owner
        if workspace.owner_id.is_empty() {
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

        // Also ensure the user has admin permissions since they have the master password
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
