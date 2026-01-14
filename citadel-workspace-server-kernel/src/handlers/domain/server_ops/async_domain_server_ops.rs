//! # Async Domain Server Operations
//!
//! This module provides the async implementation of all domain operations
//! using the BackendTransactionManager for persistence.

use crate::handlers::domain::async_ops::*;
use crate::handlers::domain::core::DomainEntity;
use crate::kernel::transaction::BackendTransactionManager;
use async_trait::async_trait;
use citadel_sdk::prelude::{NetworkError, NodeRemote, Ratchet};
use citadel_workspace_types::structs::{
    Domain, DomainPermissions, Office, Permission, Room, User, UserRole, Workspace,
};
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

    /// Clear the default flag on all offices in a workspace
    /// Used when setting a new default office
    async fn clear_default_office_in_workspace(
        &self,
        workspace_id: &str,
    ) -> Result<(), NetworkError> {
        // Get workspace to find all offices
        let workspace = match self.backend_tx_manager.get_workspace(workspace_id).await? {
            Some(w) => w,
            None => return Ok(()), // No workspace means no offices to clear
        };

        // Clear is_default on all offices
        for office_id in &workspace.offices {
            if let Some(mut office) = self.backend_tx_manager.get_office(office_id).await? {
                if office.is_default {
                    office.is_default = false;
                    self.backend_tx_manager
                        .insert_office(office_id.clone(), office)
                        .await?;
                }
            }
        }

        Ok(())
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

        // Check permission inheritance
        // Get the domain to determine its type and parent
        let domain = match self.backend_tx_manager.get_domain(entity_id).await? {
            Some(d) => d,
            None => return Ok(false), // Entity not found
        };

        match domain {
            Domain::Room { room } => {
                // Check office permissions
                if let Some(office_perms) = user.permissions.get(&room.office_id) {
                    if office_perms.contains(&permission) || office_perms.contains(&Permission::All)
                    {
                        return Ok(true);
                    }
                }

                // Check workspace permissions through office
                if let Some(Domain::Office { office }) =
                    self.backend_tx_manager.get_domain(&room.office_id).await?
                {
                    if let Some(workspace_perms) = user.permissions.get(&office.workspace_id) {
                        if workspace_perms.contains(&permission)
                            || workspace_perms.contains(&Permission::All)
                        {
                            return Ok(true);
                        }
                    }
                }
            }
            Domain::Office { office } => {
                // Check workspace permissions
                if let Some(workspace_perms) = user.permissions.get(&office.workspace_id) {
                    if workspace_perms.contains(&permission)
                        || workspace_perms.contains(&Permission::All)
                    {
                        return Ok(true);
                    }
                }
            }
            Domain::Workspace { .. } => {
                // No parent to inherit from
            }
        }

        // Also check if member of domain (membership gives ViewContent permission)
        if permission == Permission::ViewContent {
            return self.is_member_of_domain(user_id, entity_id).await;
        }

        Ok(false)
    }

    async fn is_member_of_domain(
        &self,
        user_id: &str,
        domain_id: &str,
    ) -> Result<bool, NetworkError> {
        // Get the domain from backend
        let domain = match self.backend_tx_manager.get_domain(domain_id).await? {
            Some(d) => d,
            None => return Ok(false),
        };

        // Check direct membership first
        let members = match &domain {
            Domain::Workspace { workspace } => &workspace.members,
            Domain::Office { office } => &office.members,
            Domain::Room { room } => &room.members,
        };

        if members.contains(&user_id.to_string()) {
            return Ok(true);
        }

        // Check parent domains for inheritance
        match domain {
            Domain::Room { room } => {
                // Check if member of parent office
                if self.is_member_of_domain(user_id, &room.office_id).await? {
                    return Ok(true);
                }
            }
            Domain::Office { office } => {
                // Check if member of parent workspace
                if self
                    .is_member_of_domain(user_id, &office.workspace_id)
                    .await?
                {
                    return Ok(true);
                }
            }
            Domain::Workspace { .. } => {
                // No parent to check
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

        // Get the domain
        let mut domain = match self.backend_tx_manager.get_domain(domain_id).await? {
            Some(d) => d,
            None => return Err(NetworkError::msg("Domain not found")),
        };

        // Add user to domain members
        match &mut domain {
            Domain::Workspace { workspace } => {
                if !workspace.members.contains(&user_id_to_add.to_string()) {
                    workspace.members.push(user_id_to_add.to_string());
                }
            }
            Domain::Office { office } => {
                if !office.members.contains(&user_id_to_add.to_string()) {
                    office.members.push(user_id_to_add.to_string());
                }
            }
            Domain::Room { room } => {
                if !room.members.contains(&user_id_to_add.to_string()) {
                    room.members.push(user_id_to_add.to_string());
                }
            }
        }

        // Save updated domain
        self.backend_tx_manager
            .insert_domain(domain_id.to_string(), domain)
            .await?;

        // Update user's role and permissions
        let mut user = match self.backend_tx_manager.get_user(user_id_to_add).await? {
            Some(u) => u,
            None => {
                // Create new user if doesn't exist
                User::new(
                    user_id_to_add.to_string(),
                    user_id_to_add.to_string(),
                    role.clone(),
                )
            }
        };

        // Set the user's role
        user.role = role;

        // Use the set_role_permissions method to properly set permissions for this domain
        user.set_role_permissions(domain_id);

        self.backend_tx_manager
            .insert_user(user_id_to_add.to_string(), user)
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

        // Get and update domain
        let mut domain = match self.backend_tx_manager.get_domain(domain_id).await? {
            Some(d) => d,
            None => return Err(NetworkError::msg("Domain not found")),
        };

        // Remove user from domain members
        match &mut domain {
            Domain::Workspace { workspace } => {
                workspace.members.retain(|m| m != user_id_to_remove);
            }
            Domain::Office { office } => {
                office.members.retain(|m| m != user_id_to_remove);
            }
            Domain::Room { room } => {
                room.members.retain(|m| m != user_id_to_remove);
            }
        }

        // Save updated domain
        self.backend_tx_manager
            .insert_domain(domain_id.to_string(), domain)
            .await?;

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

        // Get user and update role
        let mut user = match self.backend_tx_manager.get_user(target_user_id).await? {
            Some(u) => u,
            None => return Err(NetworkError::msg("User not found")),
        };

        // Update the role
        user.role = role;

        // Update permissions for the workspace domain based on the new role
        user.set_role_permissions(crate::WORKSPACE_ROOT_ID);

        // Handle metadata if provided
        if let Some(_metadata_bytes) = metadata {
            // TODO: Handle metadata updates when needed
        }

        self.backend_tx_manager
            .insert_user(target_user_id.to_string(), user)
            .await?;
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

        // Check if domain exists
        match self.backend_tx_manager.get_domain(domain_id).await? {
            Some(_) => {}
            None => return Err(NetworkError::msg("Domain not found")),
        };

        // Get target user
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
                "Permission denied: Not a member of this workspace",
            ));
        }

        // Get workspace from backend
        match self.backend_tx_manager.get_workspace(workspace_id).await? {
            Some(ws) => Ok(ws),
            None => Err(NetworkError::msg("Workspace not found")),
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
        // Check if a root workspace already exists
        // TODO: In future, remove WORKSPACE_ROOT_ID and allow multiple workspaces
        // Generate unique ID - for now, always use the root workspace ID in single-workspace model
        let workspace_id = crate::WORKSPACE_ROOT_ID;

        // Check if a root workspace already exists
        if self
            .backend_tx_manager
            .get_domain(workspace_id)
            .await?
            .is_some()
        {
            return Err(NetworkError::msg(
                "A root workspace already exists. Cannot create another one.",
            ));
        }

        // Verify master access password
        let passwords = self.backend_tx_manager.get_all_passwords().await?;
        if !passwords
            .get(workspace_id)
            .map(|p| p == &workspace_master_password)
            .unwrap_or(false)
        {
            return Err(NetworkError::msg("Invalid workspace password"));
        }

        // Create workspace struct
        let mut workspace = Workspace {
            id: workspace_id.to_string(),
            name: name.to_string(),
            description: description.to_string(),
            owner_id: user_id.to_string(),
            members: vec![user_id.to_string()],
            offices: Vec::new(),
            metadata: Default::default(),
        };

        // Add metadata if provided
        if let Some(meta_bytes) = metadata {
            workspace.metadata = meta_bytes;
        }

        // Save workspace
        self.backend_tx_manager
            .insert_workspace(workspace_id.to_string(), workspace.clone())
            .await?;

        // Create domain entry
        let domain = Domain::Workspace {
            workspace: workspace.clone(),
        };
        self.backend_tx_manager
            .insert_domain(workspace_id.to_string(), domain)
            .await?;

        // Save password if provided
        // TODO: In future, the workspace master password will be shared for all workspaces.
        // For now, set the password to the current workspace master password to reflect this intent.
        if !workspace_master_password.is_empty() {
            let mut passwords = self.backend_tx_manager.get_all_passwords().await?;
            passwords.insert(workspace_id.to_string(), workspace_master_password);
            self.backend_tx_manager.save_passwords(&passwords).await?;
        }

        // Grant creator admin permissions
        // For workspace creation, we need to directly set permissions since the user isn't admin yet
        let mut user = match self.backend_tx_manager.get_user(user_id).await? {
            Some(u) => u,
            None => {
                // Create user if doesn't exist
                User {
                    id: user_id.to_string(),
                    name: user_id.to_string(),
                    role: UserRole::Admin,
                    permissions: Default::default(),
                    metadata: Default::default(),
                }
            }
        };

        // Set user role to Admin for workspace creators
        user.role = UserRole::Admin;

        // Set permissions for this workspace using the role
        user.set_role_permissions(workspace_id);

        // Save updated user
        self.backend_tx_manager
            .insert_user(user_id.to_string(), user)
            .await?;

        Ok(workspace)
    }

    async fn delete_workspace(
        &self,
        _user_id: &str,
        workspace_id: &str,
        workspace_master_password: String,
    ) -> Result<(), NetworkError> {
        // System Protection: Prevent deletion of the root workspace
        if workspace_id == crate::WORKSPACE_ROOT_ID {
            return Err(NetworkError::msg("Cannot delete the root workspace"));
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
            workspace.metadata = meta_bytes;
        }

        // Add the user as a member if they're not already (since they have the master password)
        if !workspace.members.contains(&user_id.to_string()) {
            workspace.members.push(user_id.to_string());
        }

        // If workspace has no owner, the first user with master password becomes the owner
        if workspace.owner_id.is_empty() {
            println!(
                "[UPDATE_WORKSPACE] No owner set - assigning {} as workspace owner",
                user_id
            );
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
        // Check permission - need CreateOffice permission
        if !self
            .check_entity_permission(user_id, workspace_id, Permission::CreateOffice)
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
        // Check permission - need DeleteOffice permission
        if !self
            .check_entity_permission(user_id, workspace_id, Permission::DeleteOffice)
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

#[async_trait]
impl<R: Ratchet + Send + Sync + 'static> AsyncOfficeOperations<R>
    for AsyncDomainServerOperations<R>
{
    async fn create_office(
        &self,
        user_id: &str,
        workspace_id: &str,
        name: &str,
        description: &str,
        mdx_content: Option<&str>,
        is_default: Option<bool>,
    ) -> Result<Office, NetworkError> {
        // Check permission
        if !self
            .check_entity_permission(user_id, workspace_id, Permission::CreateOffice)
            .await?
        {
            return Err(NetworkError::msg("Permission denied: Cannot create office"));
        }

        // Generate unique ID
        let office_id = uuid::Uuid::new_v4().to_string();

        // If setting as default, clear default on other offices
        let set_as_default = is_default.unwrap_or(false);
        if set_as_default {
            self.clear_default_office_in_workspace(workspace_id).await?;
        }

        // Create office struct
        let office = Office {
            id: office_id.clone(),
            owner_id: user_id.to_string(),
            workspace_id: workspace_id.to_string(),
            name: name.to_string(),
            description: description.to_string(),
            members: vec![user_id.to_string()],
            rooms: Vec::new(),
            mdx_content: mdx_content.unwrap_or_default().to_string(),
            rules: None,
            chat_enabled: false,
            chat_channel_id: None,
            default_permissions: DomainPermissions::default(),
            is_default: set_as_default,
            metadata: Default::default(),
        };

        // Save office
        self.backend_tx_manager
            .insert_office(office_id.clone(), office.clone())
            .await?;

        // Add office to workspace
        self.add_office_to_workspace(user_id, workspace_id, &office_id)
            .await?;

        // Note: Creator is already added to members in the Office struct initialization above

        Ok(office)
    }

    async fn get_office(&self, user_id: &str, office_id: &str) -> Result<String, NetworkError> {
        // Check if user is member
        if !self.is_member_of_domain(user_id, office_id).await? {
            return Err(NetworkError::msg(
                "Permission denied: Not a member of this office",
            ));
        }

        // Get office
        let office = match self.backend_tx_manager.get_office(office_id).await? {
            Some(o) => o,
            None => return Err(NetworkError::msg("Office not found")),
        };

        // Return as JSON string
        serde_json::to_string(&office)
            .map_err(|e| NetworkError::msg(format!("Failed to serialize office: {}", e)))
    }

    async fn delete_office(&self, user_id: &str, office_id: &str) -> Result<Office, NetworkError> {
        // Check permission
        if !self
            .check_entity_permission(user_id, office_id, Permission::DeleteOffice)
            .await?
        {
            return Err(NetworkError::msg("Permission denied: Cannot delete office"));
        }

        // Get office to return
        let office = match self.backend_tx_manager.get_office(office_id).await? {
            Some(o) => o,
            None => return Err(NetworkError::msg("Office not found")),
        };

        // Remove from parent workspace
        self.remove_office_from_workspace(user_id, &office.workspace_id, office_id)
            .await?;

        // Delete all rooms in office
        for room_id in &office.rooms {
            self.backend_tx_manager.remove_room(room_id).await?;
        }

        // Remove office
        self.backend_tx_manager.remove_office(office_id).await?;

        Ok(office)
    }

    async fn update_office(
        &self,
        user_id: &str,
        office_id: &str,
        name: Option<&str>,
        description: Option<&str>,
        mdx_content: Option<&str>,
        is_default: Option<bool>,
    ) -> Result<Office, NetworkError> {
        // Check permission
        if !self
            .check_entity_permission(user_id, office_id, Permission::UpdateOffice)
            .await?
        {
            return Err(NetworkError::msg("Permission denied: Cannot update office"));
        }

        // Get and update office
        let mut office = match self.backend_tx_manager.get_office(office_id).await? {
            Some(o) => o,
            None => return Err(NetworkError::msg("Office not found")),
        };

        if let Some(new_name) = name {
            office.name = new_name.to_string();
        }
        if let Some(new_desc) = description {
            office.description = new_desc.to_string();
        }
        if let Some(new_mdx) = mdx_content {
            office.mdx_content = new_mdx.to_string();
        }
        if let Some(new_is_default) = is_default {
            // If setting as default, clear default on other offices first
            if new_is_default {
                self.clear_default_office_in_workspace(&office.workspace_id)
                    .await?;
            }
            office.is_default = new_is_default;
        }

        // Save updated office
        self.backend_tx_manager
            .insert_office(office_id.to_string(), office.clone())
            .await?;

        Ok(office)
    }

    async fn list_offices(
        &self,
        user_id: &str,
        workspace_id: Option<String>,
    ) -> Result<Vec<Office>, NetworkError> {
        let all_domains = self.backend_tx_manager.get_all_domains().await?;

        let mut accessible_offices = Vec::new();
        for (domain_id, domain) in all_domains {
            if let Domain::Office { office } = domain {
                // Check if user is member
                if self.is_member_of_domain(user_id, &domain_id).await? {
                    // If workspace filter provided, check parent
                    if let Some(ref ws_id) = workspace_id {
                        if office.workspace_id == *ws_id {
                            accessible_offices.push(office);
                        }
                    } else {
                        accessible_offices.push(office);
                    }
                }
            }
        }

        Ok(accessible_offices)
    }

    async fn list_offices_in_workspace(
        &self,
        user_id: &str,
        workspace_id: &str,
    ) -> Result<Vec<Office>, NetworkError> {
        self.list_offices(user_id, Some(workspace_id.to_string()))
            .await
    }
}

#[async_trait]
impl<R: Ratchet + Send + Sync + 'static> AsyncRoomOperations<R> for AsyncDomainServerOperations<R> {
    async fn create_room(
        &self,
        user_id: &str,
        office_id: &str,
        name: &str,
        description: &str,
        mdx_content: Option<&str>,
    ) -> Result<Room, NetworkError> {
        // Check permission - user needs CreateRoom permission in office
        if !self
            .check_entity_permission(user_id, office_id, Permission::CreateRoom)
            .await?
        {
            return Err(NetworkError::msg("Permission denied: Cannot create room"));
        }

        // Generate unique ID
        let room_id = uuid::Uuid::new_v4().to_string();

        // Create room struct
        let room = Room {
            id: room_id.clone(),
            owner_id: user_id.to_string(),
            office_id: office_id.to_string(),
            name: name.to_string(),
            description: description.to_string(),
            members: vec![user_id.to_string()],
            mdx_content: mdx_content.unwrap_or_default().to_string(),
            rules: None,
            chat_enabled: false,
            chat_channel_id: None,
            default_permissions: DomainPermissions::default(),
            metadata: Default::default(),
        };

        // Save room
        self.backend_tx_manager
            .insert_room(room_id.clone(), room.clone())
            .await?;

        // Add room to office
        let mut office = match self.backend_tx_manager.get_office(office_id).await? {
            Some(o) => o,
            None => return Err(NetworkError::msg("Office not found")),
        };

        office.rooms.push(room_id.clone());
        self.backend_tx_manager
            .insert_office(office_id.to_string(), office)
            .await?;

        // Note: Creator is already added to members in the Room struct initialization above

        Ok(room)
    }

    async fn get_room(&self, user_id: &str, room_id: &str) -> Result<Room, NetworkError> {
        // Check if user is member
        if !self.is_member_of_domain(user_id, room_id).await? {
            return Err(NetworkError::msg(
                "Permission denied: Not a member of this room",
            ));
        }

        // Get room
        match self.backend_tx_manager.get_room(room_id).await? {
            Some(r) => Ok(r),
            None => Err(NetworkError::msg("Room not found")),
        }
    }

    async fn delete_room(&self, user_id: &str, room_id: &str) -> Result<Room, NetworkError> {
        // Check permission
        if !self
            .check_entity_permission(user_id, room_id, Permission::DeleteRoom)
            .await?
        {
            return Err(NetworkError::msg("Permission denied: Cannot delete room"));
        }

        // Get room to return
        let room = match self.backend_tx_manager.get_room(room_id).await? {
            Some(r) => r,
            None => return Err(NetworkError::msg("Room not found")),
        };

        // Remove from parent office
        let mut office = match self.backend_tx_manager.get_office(&room.office_id).await? {
            Some(o) => o,
            None => return Err(NetworkError::msg("Parent office not found")),
        };

        office.rooms.retain(|r| r != room_id);
        self.backend_tx_manager
            .insert_office(room.office_id.clone(), office)
            .await?;

        // Remove room
        self.backend_tx_manager.remove_room(room_id).await?;

        Ok(room)
    }

    async fn update_room(
        &self,
        user_id: &str,
        room_id: &str,
        name: Option<&str>,
        description: Option<&str>,
        mdx_content: Option<&str>,
    ) -> Result<Room, NetworkError> {
        // Check permission
        if !self
            .check_entity_permission(user_id, room_id, Permission::UpdateRoom)
            .await?
        {
            return Err(NetworkError::msg("Permission denied: Cannot update room"));
        }

        // Get and update room
        let mut room = match self.backend_tx_manager.get_room(room_id).await? {
            Some(r) => r,
            None => return Err(NetworkError::msg("Room not found")),
        };

        if let Some(new_name) = name {
            room.name = new_name.to_string();
        }
        if let Some(new_desc) = description {
            room.description = new_desc.to_string();
        }
        if let Some(new_mdx) = mdx_content {
            room.mdx_content = new_mdx.to_string();
        }

        // Save updated room
        self.backend_tx_manager
            .insert_room(room_id.to_string(), room.clone())
            .await?;

        Ok(room)
    }

    async fn list_rooms(
        &self,
        user_id: &str,
        office_id: Option<String>,
    ) -> Result<Vec<Room>, NetworkError> {
        let all_domains = self.backend_tx_manager.get_all_domains().await?;

        let mut accessible_rooms = Vec::new();
        for (domain_id, domain) in all_domains {
            if let Domain::Room { room } = domain {
                // Check if user is member
                if self.is_member_of_domain(user_id, &domain_id).await? {
                    // If office filter provided, check parent
                    if let Some(ref off_id) = office_id {
                        if room.office_id == *off_id {
                            accessible_rooms.push(room);
                        }
                    } else {
                        accessible_rooms.push(room);
                    }
                }
            }
        }

        Ok(accessible_rooms)
    }
}

// Implement the complete trait
impl<R: Ratchet + Send + Sync + 'static> AsyncCompleteDomainOperations<R>
    for AsyncDomainServerOperations<R>
{
}
