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
        // Check if this is the workspace root (use Domain::Workspace for workspace)
        if domain_id == crate::WORKSPACE_ROOT_ID {
            if let Some(workspace) = self.backend_tx_manager.get_workspace(domain_id).await? {
                return Ok(workspace.members.contains(&user_id.to_string()));
            }
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
            let mut workspace = match self.backend_tx_manager.get_workspace(domain_id).await? {
                Some(ws) => ws,
                None => return Err(NetworkError::msg("Workspace not found")),
            };

            if !workspace.members.contains(&user_id_to_add.to_string()) {
                workspace.members.push(user_id_to_add.to_string());
            }

            self.backend_tx_manager
                .insert_workspace(domain_id.to_string(), workspace)
                .await?;
        } else {
            // For all other entities, use DomainNode tree storage
            let mut nodes = self.backend_tx_manager.get_all_nodes().await?;
            let node = nodes
                .get_mut(domain_id)
                .ok_or_else(|| NetworkError::msg("Domain not found"))?;
            if !node.members.contains(&user_id_to_add.to_string()) {
                node.members.push(user_id_to_add.to_string());
            }
            self.backend_tx_manager.save_nodes(&nodes).await?;
        }

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

        // If this is the workspace root, use the workspace storage
        if domain_id == crate::WORKSPACE_ROOT_ID {
            let mut workspace = match self.backend_tx_manager.get_workspace(domain_id).await? {
                Some(ws) => ws,
                None => return Err(NetworkError::msg("Workspace not found")),
            };

            workspace.members.retain(|m| m != user_id_to_remove);

            self.backend_tx_manager
                .insert_workspace(domain_id.to_string(), workspace)
                .await?;
        } else {
            // For all other entities, use DomainNode tree storage
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
