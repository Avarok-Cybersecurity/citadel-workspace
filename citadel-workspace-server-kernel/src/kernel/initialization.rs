use super::core::WorkspaceServerKernel;
use crate::handlers::domain::{DomainOperations, TransactionOperations};
// use crate::kernel::transaction::TransactionManagerExt;
use crate::kernel::transaction::{Transaction, BackendTransactionManager};
use crate::{WORKSPACE_MASTER_PASSWORD_KEY, WORKSPACE_ROOT_ID};
use citadel_logging::debug;
use citadel_sdk::prelude::{NetworkError, Ratchet};
use citadel_workspace_types::structs::{
    MetadataValue as InternalMetadataValue, Permission, User, UserRole, WorkspaceRoles,
};
use parking_lot::RwLock;
use std::collections::HashSet;
use std::sync::Arc;

// Note: These methods have been removed. Use AsyncWorkspaceServerKernel instead.
/*
impl<R: Ratchet> WorkspaceServerKernel<R> {
    /// Helper to inject the initial admin user into the database
    ///
    /// This method performs the complete admin user and workspace setup:
    /// 1. Creates the admin user with full permissions
    /// 2. Creates the root workspace domain if it doesn't exist
    /// 3. Sets the workspace password securely
    /// 4. Adds the admin user to the root workspace domain
    ///
    /// This is idempotent - can be called multiple times safely.
    pub fn inject_admin_user(
        &self,
        username: &str,
        display_name: &str,
        workspace_password: &str,
    ) -> Result<(), NetworkError> {
        self.tx_manager().with_write_transaction(|tx| {
            // Check if user already exists
            let user_exists = tx.get_user(username).is_some();

            if !user_exists {
                let mut user = User::new(
                    username.to_string(),
                    display_name.to_string(),
                    UserRole::Admin,
                );

                // Add primary_workspace_id to admin user's metadata
                user.metadata.insert(
                    "primary_workspace_id".to_string(),
                    InternalMetadataValue::String(WORKSPACE_ROOT_ID.to_string()),
                );

                // Grant the admin user all permissions on the root workspace
                let mut root_permissions = HashSet::new();
                root_permissions.insert(Permission::All);
                user.permissions
                    .insert(WORKSPACE_ROOT_ID.to_string(), root_permissions);

                tx.insert_user(username.to_string(), user)?;
            }

            // Ensure the root workspace domain exists and its password is set
            if tx.get_domain(WORKSPACE_ROOT_ID).is_none() {
                let root_workspace_obj = citadel_workspace_types::structs::Workspace {
                    id: WORKSPACE_ROOT_ID.to_string(),
                    name: "Root Workspace".to_string(),
                    description: "The main workspace for this instance.".to_string(),
                    owner_id: username.to_string(),
                    members: Vec::new(), // Start with empty members list - will be populated by add_user_to_domain
                    offices: Vec::new(),
                    metadata: Default::default(), // Will be populated by set_workspace_password
                    password_protected: !workspace_password.is_empty(),
                };

                let root_domain_enum_variant =
                    citadel_workspace_types::structs::Domain::Workspace {
                        workspace: root_workspace_obj.clone(),
                    };

                tx.insert_workspace(WORKSPACE_ROOT_ID.to_string(), root_workspace_obj)?;
                tx.insert_domain(WORKSPACE_ROOT_ID.to_string(), root_domain_enum_variant)?;
            }

            // Always set/update the workspace password for the root workspace during admin injection.
            // This ensures it's correctly hashed and stored in the workspace's metadata.
            if !workspace_password.is_empty() {
                debug!(
                    "Injecting admin: Setting/Updating password for WORKSPACE_ROOT_ID ('{}') to: '{}'",
                    WORKSPACE_ROOT_ID, workspace_password
                );
                tx.set_workspace_password(WORKSPACE_ROOT_ID, workspace_password)?;
            } else {
                // If no password is provided during admin injection, ensure any existing password metadata is cleared.
                // This might be an edge case, but handles consistency.
                debug!(
                    "Injecting admin: No workspace password provided for WORKSPACE_ROOT_ID ('{}'). Ensuring it's not password protected.",
                    WORKSPACE_ROOT_ID
                );
                // For now, if password is empty, password_protected was set to false. 
                // The set_workspace_password should handle empty strings appropriately.
            }

            // Add the admin user to the root workspace domain only if they're not already a member
            if !tx.is_member_of_domain(username, WORKSPACE_ROOT_ID)? {
                tx.add_user_to_domain(username, WORKSPACE_ROOT_ID, UserRole::Admin)?;
            }

            Ok(())
        })
    }

    /// Verifies the provided workspace password against the one stored for the admin user
    ///
    /// This method provides secure password verification by:
    /// 1. Retrieving the stored password from the admin user's metadata
    /// 2. Performing secure comparison with the provided password
    /// 3. Returning appropriate error messages for different failure modes
    pub async fn verify_workspace_password(
        &self,
        provided_password: &str,
    ) -> Result<(), NetworkError> {
        // Get the stored password Option from the admin user's metadata within a transaction
        let stored_password_opt = self.tx_manager().with_read_transaction(|tx| {
            // Closure returns Result<Option<InternalMetadataValue>, NetworkError>
            match tx.get_user(&self.admin_username) {
                Some(user) => Ok(user.metadata.get(WORKSPACE_MASTER_PASSWORD_KEY).cloned()),
                None => Err(NetworkError::msg(format!(
                    "Admin user {} not found during password verification",
                    self.admin_username
                ))),
            }
        })?; // Handle potential transaction error

        // Now, handle the Option containing the password value
        match stored_password_opt {
            Some(InternalMetadataValue::String(stored_password)) => {
                // Compare the stored password with the provided password
                if provided_password == stored_password {
                    Ok(())
                } else {
                    Err(NetworkError::msg("Incorrect workspace master password"))
                }
            }
            Some(_) => Err(NetworkError::msg(
                "Workspace master password stored with incorrect type",
            )), // Handle wrong type
            None => Err(NetworkError::msg(
                "Workspace master password not found in admin metadata",
            )), // Handle missing password
        }
    }
}
*/
