//! # Workspace Operations Module
//!
//! This module provides comprehensive workspace management functionality within the domain system.
//! It handles the complete lifecycle of workspace entities including creation, deletion, member management,
//! and administrative operations with proper permission validation and data consistency.
//!
//! ## Key Features
//!
//! ### Workspace Lifecycle Management
//! - **Workspace Creation**: Create new workspaces with master password protection and root workspace validation
//! - **Workspace Deletion**: Safe deletion with permission checks and ownership validation  
//! - **Workspace Queries**: Retrieve workspace information and member lists
//!
//! ### Member Management
//! - **User Addition**: Add users to workspaces with role-based permission assignment
//! - **User Removal**: Remove users with ownership protection and permission validation
//! - **Role Management**: Assign and manage user roles within workspace contexts
//!
//! ### Security & Permissions
//! - **Master Password Validation**: Enforce master password requirements for workspace operations
//! - **Permission Checking**: Comprehensive permission validation for all administrative operations
//! - **Ownership Protection**: Prevent removal of last owners and unauthorized access
//!
//! ## Data Consistency
//! All operations maintain consistency between workspace entities and their corresponding domain entries,
//! ensuring referential integrity and proper permission inheritance throughout the domain hierarchy.

pub mod workspace_ops {
    use crate::kernel::transaction::Transaction;
    use citadel_logging::{error, info, warn};
    use citadel_sdk::prelude::NetworkError;
    use citadel_workspace_types::structs::{Domain, Permission, UserRole, Workspace};
    use serde::{Deserialize, Serialize};
    use uuid::Uuid;

    use crate::handlers::domain::permission_denied;

    // ════════════════════════════════════════════════════════════════════════════
    // DATA STRUCTURES
    // ════════════════════════════════════════════════════════════════════════════

    /// Represents a collection of workspace identifiers for database operations.
    ///
    /// This structure is used primarily for bulk operations and administrative
    /// queries that need to work with multiple workspaces simultaneously.
    #[derive(Debug, Clone, Serialize, Deserialize)]
    pub struct WorkspaceDBList {
        /// List of workspace IDs for bulk operations
        pub workspaces: Vec<String>,
    }

    /// Represents a workspace identifier paired with its master password.
    ///
    /// This structure is used for operations that require both workspace
    /// identification and password authentication, such as administrative
    /// operations that modify workspace structure or membership.
    #[derive(Debug, Clone, Serialize, Deserialize)]
    pub struct WorkspacePasswordPair {
        /// Unique identifier for the workspace
        pub workspace_id: String,
        /// Master password for workspace access
        pub password: String,
    }

    // ════════════════════════════════════════════════════════════════════════════
    // WORKSPACE LIFECYCLE OPERATIONS
    // ════════════════════════════════════════════════════════════════════════════

    /// Creates a new workspace with comprehensive validation and setup.
    ///
    /// This function handles the complete workspace creation process including validation,
    /// domain setup, permission assignment, and password management. It ensures that only
    /// one root workspace exists and validates master passwords for additional workspaces.
    ///
    /// # Arguments
    /// * `tx` - Mutable transaction for database operations
    /// * `user_id` - ID of the user creating the workspace (becomes owner)
    /// * `name` - Display name for the new workspace
    /// * `description` - Detailed description of the workspace purpose
    /// * `metadata` - Optional metadata for extended workspace properties
    /// * `workspace_password` - Master password for the workspace
    ///
    /// # Returns
    /// * `Ok(Workspace)` - Successfully created workspace with full configuration
    /// * `Err(NetworkError)` - Creation failed due to validation or system errors
    ///
    /// # Validation Rules
    /// - Only one root workspace can exist in the system
    /// - User creating the workspace must exist in the system
    /// - Master password must match existing workspace passwords for additional workspaces
    /// - Workspace password is required and will be securely hashed
    ///
    /// # Side Effects
    /// - Creates workspace entity in database
    /// - Creates corresponding domain entry for permission hierarchy
    /// - Assigns Owner role to the creating user
    /// - Sets secure password hash for workspace authentication
    #[allow(dead_code)]
    pub(crate) fn create_workspace_inner(
        tx: &mut dyn Transaction,
        user_id: &str,
        name: &str,
        description: &str,
        metadata: Option<Vec<u8>>,
        workspace_password: String,
    ) -> Result<Workspace, NetworkError> {
        // Validation: Check if a root workspace already exists
        let found_root_ws = tx.get_workspace(crate::WORKSPACE_ROOT_ID);
        let root_ws_exists = found_root_ws.is_some();
        if root_ws_exists {
            return Err(NetworkError::msg(
                "A root workspace already exists. Cannot create another one.",
            ));
        }

        // Validation: Ensure the user creating the workspace exists
        let _user = tx
            .get_user(user_id)
            .ok_or_else(|| NetworkError::msg(format!("User {} not found", user_id)))?;

        // Master Password Validation: For additional workspaces, validate against existing master password
        let all_workspaces = tx.get_all_workspaces();
        if let Some(first_workspace_id) = all_workspaces.keys().next() {
            let master_password = tx.workspace_password(first_workspace_id).ok_or_else(|| {
                NetworkError::msg("Master password not found for initial workspace")
            })?;

            if workspace_password != master_password {
                return Err(NetworkError::msg("Incorrect workspace master password"));
            }
        }

        // Generate unique workspace identifier
        let new_workspace_id_uuid = Uuid::new_v4();
        let new_workspace_id_str = new_workspace_id_uuid.to_string();

        // Create workspace entity with initial configuration
        let new_workspace_dto = Workspace {
            id: new_workspace_id_str.clone(),
            name: name.to_string(),
            owner_id: user_id.to_string(),
            description: description.to_string(),
            members: vec![user_id.to_string()],
            metadata: metadata.unwrap_or_default(),
            offices: Vec::new(),
            password_protected: !workspace_password.is_empty(),
        };

        // Security: Set password protection if provided (required for first workspace)
        if !workspace_password.is_empty() {
            tx.set_workspace_password(&new_workspace_id_str, &workspace_password)?;
        } else {
            // This case should ideally not be hit if we enforce password for the first workspace
            warn!(
                "Creating workspace '{}' without a password.",
                new_workspace_id_str
            );
        }

        // Database Operations: Insert workspace entity
        tx.insert_workspace(new_workspace_id_str.clone(), new_workspace_dto.clone())?;

        // Domain Hierarchy: Insert corresponding domain entry for permission inheritance
        tx.insert_domain(
            new_workspace_id_str.clone(),
            Domain::Workspace {
                workspace: new_workspace_dto.clone(),
            },
        )?;

        // Permission Assignment: Grant creator Owner role for the new workspace domain
        tx.add_user_to_domain(user_id, &new_workspace_id_str, UserRole::Owner)?;

        info!(
            "User '{}' created new workspace '{}' with id '{}'",
            user_id, name, new_workspace_id_str
        );

        Ok(new_workspace_dto)
    }

    /// Deletes a workspace with comprehensive validation and cleanup.
    ///
    /// This function safely removes a workspace from the system with proper permission
    /// checking and protection against deleting critical system workspaces. It performs
    /// cascading cleanup of both the workspace entity and its domain entry.
    ///
    /// # Arguments
    /// * `tx` - Mutable transaction for database operations
    /// * `user_id` - ID of the user requesting deletion (must have permission)
    /// * `workspace_id` - ID of the workspace to delete
    ///
    /// # Returns
    /// * `Ok(())` - Workspace successfully deleted with full cleanup
    /// * `Err(NetworkError)` - Deletion failed due to permission or validation errors
    ///
    /// # Permission Requirements
    /// - User must exist in the system
    /// - User must have `DeleteWorkspace` permission for the target workspace
    /// - Root workspace cannot be deleted (system protection)
    ///
    /// # Side Effects
    /// - Removes workspace entity from database
    /// - Removes corresponding domain entry
    /// - Cascading cleanup of workspace-related data
    #[allow(dead_code)]
    pub(crate) fn delete_workspace_inner(
        tx: &mut dyn Transaction,
        user_id: &str,
        workspace_id: &str,
    ) -> Result<(), NetworkError> {
        // System Protection: Prevent deletion of the root workspace
        if workspace_id == crate::WORKSPACE_ROOT_ID {
            return Err(NetworkError::msg("Cannot delete the root workspace"));
        }

        // Permission Validation: User must have DeleteWorkspace permission
        let user = tx
            .get_user(user_id)
            .ok_or_else(|| NetworkError::msg(format!("User {} not found", user_id)))?;
        if !user.has_permission(workspace_id, Permission::DeleteWorkspace) {
            return Err(permission_denied(format!(
                "User {} does not have permission to delete workspace {}",
                user_id, workspace_id
            )));
        }

        // Cascading Cleanup: Remove domain entry first for referential integrity
        tx.remove_domain(workspace_id)?;

        // Primary Cleanup: Remove the workspace entity
        tx.remove_workspace(workspace_id)?;

        info!("Workspace {} deleted by user {}", workspace_id, user_id);
        Ok(())
    }

    // ════════════════════════════════════════════════════════════════════════════
    // MEMBER MANAGEMENT OPERATIONS
    // ════════════════════════════════════════════════════════════════════════════

    /// Adds a user to a workspace with role assignment and permission configuration.
    ///
    /// This function handles the complete process of adding a user to a workspace,
    /// including permission validation, role assignment, and updating both the workspace
    /// membership list and the user's permission set. It ensures proper role-based
    /// access control and maintains data consistency.
    ///
    /// # Arguments
    /// * `tx` - Mutable transaction for database operations
    /// * `admin_id` - ID of the admin user performing the addition (must have permission)
    /// * `user_to_add_id` - ID of the user being added to the workspace
    /// * `workspace_id` - ID of the target workspace
    /// * `role` - Role to assign to the user in this workspace
    ///
    /// # Returns
    /// * `Ok(())` - User successfully added with proper role and permissions
    /// * `Err(NetworkError)` - Addition failed due to permission or validation errors
    ///
    /// # Permission Requirements
    /// - Admin user must exist and have `AddUsers` permission for the workspace
    /// - Target user must exist in the system
    /// - Workspace must exist and be accessible
    ///
    /// # Side Effects
    /// - Adds user to workspace members list (if not already present)
    /// - Assigns role-based permissions to the user for this workspace
    /// - Updates workspace entity in database
    /// - Updates corresponding domain entry for permission inheritance
    #[allow(dead_code)]
    pub(crate) fn add_user_to_workspace_inner(
        tx: &mut dyn Transaction,
        admin_id: &str,
        user_to_add_id: &str,
        workspace_id: &str,
        role: UserRole,
    ) -> Result<(), NetworkError> {
        // Permission Validation: Admin must have AddUsers permission
        let admin_user = tx
            .get_user(admin_id)
            .ok_or_else(|| NetworkError::msg(format!("Admin user {} not found", admin_id)))?;

        println!("[AUTCWI_PRE_PERM_CHECK_SIMPLE_PRINTLN] Actor: {}, Workspace: {}, About to call has_permission. User object: {:?}", admin_id, workspace_id, admin_user);
        let has_perm_result = admin_user.has_permission(workspace_id, Permission::AddUsers);
        println!(
            "[AUTCWI_POST_PERM_CHECK_SIMPLE_PRINTLN] Actor: {}, Workspace: {}, has_perm_result: {}",
            admin_id, workspace_id, has_perm_result
        );

        if !has_perm_result {
            error!(target: "citadel", "Admin {} does not have AddUsers permission for workspace {}", admin_id, workspace_id);
            return Err(permission_denied(format!(
                "Admin {} does not have permission to add users to workspace {}",
                admin_id, workspace_id
            )));
        }

        // Entity Validation: Ensure workspace exists and is accessible
        let mut workspace = tx
            .get_workspace_mut(workspace_id)
            .ok_or_else(|| NetworkError::msg(format!("Workspace {} not found", workspace_id)))?
            .clone();

        // Entity Validation: Ensure the user to add exists
        let user_to_add = tx.get_user_mut(user_to_add_id).ok_or_else(|| {
            NetworkError::msg(format!("User to add {} not found", user_to_add_id))
        })?;

        // Membership Management: Add user to workspace members list (if not already present)
        if !workspace.members.contains(&user_to_add_id.to_string()) {
            workspace.members.push(user_to_add_id.to_string());
        } else {
            warn!(
                "User {} is already a member of workspace {}. Role/permissions will still be updated.",
                user_to_add_id, workspace_id
            );
        }

        // Permission Assignment: Retrieve role-based permissions for workspace domain
        let role_permissions = crate::kernel::transaction::rbac::retrieve_role_permissions(
            &role,
            &crate::kernel::transaction::rbac::DomainType::Workspace,
        );

        // Permission Configuration: Add/update permissions for the user on this workspace
        user_to_add
            .permissions
            .entry(workspace_id.to_string())
            .or_default()
            .extend(role_permissions.iter().cloned());

        // Database Updates: Update workspace with modified members list
        tx.update_workspace(workspace_id, workspace.clone())?;

        // Domain Hierarchy: Update corresponding domain entry
        tx.update_domain(
            workspace_id,
            Domain::Workspace {
                workspace: workspace.clone(),
            },
        )?;

        info!(
            "Admin '{}' added user '{}' to workspace '{}' with role '{}'",
            admin_id, user_to_add_id, workspace_id, &role
        );
        Ok(())
    }

    /// Removes a user from a workspace with ownership protection and validation.
    ///
    /// This function safely removes a user from a workspace with comprehensive validation
    /// including ownership protection to prevent removing the last owner. It maintains
    /// data consistency by updating both the workspace entity and domain hierarchy.
    ///
    /// # Arguments
    /// * `tx` - Mutable transaction for database operations
    /// * `admin_id` - ID of the admin user performing the removal (must have permission)
    /// * `user_to_remove_id` - ID of the user being removed from the workspace
    /// * `workspace_id` - ID of the target workspace
    ///
    /// # Returns
    /// * `Ok(())` - User successfully removed from workspace
    /// * `Err(NetworkError)` - Removal failed due to permission, validation, or ownership errors
    ///
    /// # Permission Requirements
    /// - Admin user must exist and have `RemoveUsers` permission for the workspace
    /// - Target user must be a current member of the workspace
    /// - Cannot remove the last owner (ownership protection)
    ///
    /// # Side Effects
    /// - Removes user from workspace members list
    /// - Updates workspace entity in database
    /// - Updates corresponding domain entry
    /// - Preserves workspace ownership integrity
    #[allow(dead_code)]
    pub(crate) fn remove_user_from_workspace_inner(
        tx: &mut dyn Transaction,
        admin_id: &str,
        user_to_remove_id: &str,
        workspace_id: &str,
    ) -> Result<(), NetworkError> {
        // Permission Validation: Admin must have RemoveUsers permission
        let admin_user = tx
            .get_user(admin_id)
            .ok_or_else(|| NetworkError::msg(format!("Admin user {} not found", admin_id)))?;
        if !admin_user.has_permission(workspace_id, Permission::RemoveUsers) {
            return Err(permission_denied(format!(
                "Admin {} does not have permission to remove users from workspace {}",
                admin_id, workspace_id
            )));
        }

        // Entity Validation: Ensure workspace exists and is accessible
        let mut workspace = tx
            .get_workspace_mut(workspace_id)
            .ok_or_else(|| NetworkError::msg(format!("Workspace {} not found", workspace_id)))?
            .clone();

        // Membership Validation: Ensure user is a current member
        if workspace.members.contains(&user_to_remove_id.to_string()) {
            // Ownership Protection: Prevent removing the last owner
            if workspace.owner_id == user_to_remove_id && workspace.members.len() == 1 {
                return Err(NetworkError::msg(format!(
                    "Cannot remove the last owner ({}) from workspace {}",
                    user_to_remove_id, workspace_id
                )));
            }
            // Membership Update: Remove user from members list
            workspace.members.retain(|id| id != user_to_remove_id);
        } else {
            return Err(NetworkError::msg(format!(
                "User {} not found in workspace {} or not a member",
                user_to_remove_id, workspace_id
            )));
        }

        // Database Updates: Update workspace with modified member list
        tx.update_workspace(workspace_id, workspace.clone())?;

        // Domain Hierarchy: Update corresponding domain entry
        tx.update_domain(
            workspace_id,
            Domain::Workspace {
                workspace: workspace.clone(),
            },
        )?;

        info!(
            "Admin '{}' removed user '{}' from workspace '{}'",
            admin_id, user_to_remove_id, workspace_id
        );
        Ok(())
    }

    // ════════════════════════════════════════════════════════════════════════════
    // QUERY AND ADMINISTRATIVE OPERATIONS
    // ════════════════════════════════════════════════════════════════════════════

    /// Retrieves all workspace identifiers for administrative operations.
    ///
    /// This function provides a simple way to get a list of all workspace IDs
    /// in the system, primarily for internal server use and administrative
    /// operations that need to work across all workspaces.
    ///
    /// # Arguments
    /// * `_tx` - Read-only transaction for database operations
    ///
    /// # Returns
    /// * `Ok(WorkspaceDBList)` - List containing all workspace IDs
    /// * `Err(NetworkError)` - Query failed due to system errors
    ///
    /// # Usage
    /// This function is primarily used for:
    /// - Administrative dashboards showing all workspaces
    /// - Bulk operations across multiple workspaces
    /// - System monitoring and reporting features
    /// - Migration and backup operations
    #[allow(dead_code)]
    pub(crate) fn get_all_workspace_ids_inner(
        _tx: &dyn Transaction,
    ) -> Result<WorkspaceDBList, NetworkError> {
        let workspace_ids: Vec<String> = _tx.get_all_workspaces().keys().cloned().collect();

        Ok(WorkspaceDBList {
            workspaces: workspace_ids,
        })
    }
}
