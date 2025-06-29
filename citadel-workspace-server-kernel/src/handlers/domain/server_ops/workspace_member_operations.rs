use crate::handlers::domain::server_ops::DomainServerOperations;
use crate::handlers::domain::UpdateOperation;
use crate::kernel::transaction::TransactionManagerExt;
use citadel_sdk::prelude::{NetworkError, Ratchet};
use citadel_workspace_types::structs::{Permission, UserRole};

impl<R: Ratchet + Send + Sync + 'static> DomainServerOperations<R> {
    pub fn add_user_to_workspace_impl(
        &self,
        user_id: &str,
        workspace_id: &str,
        member_id: &str,
        role: UserRole,
    ) -> Result<(), NetworkError> {
        self.with_write_transaction(|tx| {
            // Check if the acting user has permission to add users to this workspace
            if !self.check_entity_permission_impl(tx, user_id, workspace_id, Permission::AddUsers)? {
                return Err(NetworkError::msg(format!(
                    "User '{}' does not have permission to add users to workspace '{}'",
                    user_id, workspace_id
                )));
            }

            // Check if the member exists
            if tx.get_user(member_id).is_none() {
                return Err(NetworkError::msg(format!(
                    "User '{}' not found",
                    member_id
                )));
            }

            // Add the user to the workspace
            tx.add_user_to_domain(member_id, workspace_id, role)?;
            Ok(())
        })
    }

    pub fn remove_user_from_workspace_impl(
        &self,
        user_id: &str,
        workspace_id: &str,
        member_id: &str,
    ) -> Result<(), NetworkError> {
        self.with_write_transaction(|tx| {
            // Check if the acting user has permission to remove users from this workspace
            if !self.check_entity_permission_impl(tx, user_id, workspace_id, Permission::RemoveUsers)? {
                return Err(NetworkError::msg(format!(
                    "User '{}' does not have permission to remove users from workspace '{}'",
                    user_id, workspace_id
                )));
            }

            // Check if the member exists
            if tx.get_user(member_id).is_none() {
                return Err(NetworkError::msg(format!(
                    "User '{}' not found",
                    member_id
                )));
            }

            // Remove the user from the workspace
            tx.remove_user_from_domain(member_id, workspace_id)?;
            Ok(())
        })
    }

    pub fn update_workspace_member_role_impl(
        &self,
        actor_user_id: &str,
        target_user_id: &str,
        role: UserRole,
        _metadata: Option<Vec<u8>>,
    ) -> Result<(), NetworkError> {
        use crate::WORKSPACE_ROOT_ID;

        self.with_write_transaction(|tx| {
            // Check if the actor has permission to modify user roles
            if !self.is_admin_impl(tx, actor_user_id)? {
                return Err(NetworkError::msg(format!(
                    "User '{}' does not have admin privileges to update member roles",
                    actor_user_id
                )));
            }

            // Check if the target user exists
            if let Some(mut user) = tx.get_user(target_user_id).cloned() {
                // Update the user's role
                user.role = role;
                tx.insert_user(target_user_id.to_string(), user)?;

                // Also update the user's role in the root workspace domain
                if let Some(mut domain) = tx.get_domain(WORKSPACE_ROOT_ID).cloned() {
                    // Update the member's role in the domain
                    if let Some(member_pos) = domain
                        .members()
                        .iter()
                        .position(|member_id| member_id == target_user_id)
                    {
                        // For simplicity, we'll re-add the user with the new role
                        tx.remove_user_from_domain(target_user_id, WORKSPACE_ROOT_ID)?;
                        tx.add_user_to_domain(target_user_id, WORKSPACE_ROOT_ID, role)?;
                    }
                }

                Ok(())
            } else {
                Err(NetworkError::msg(format!(
                    "Target user '{}' not found",
                    target_user_id
                )))
            }
        })
    }

    pub fn update_member_permissions_impl(
        &self,
        actor_user_id: &str,
        target_user_id: &str,
        domain_id: &str,
        permissions: Vec<Permission>,
        operation: UpdateOperation,
    ) -> Result<(), NetworkError> {
        self.with_write_transaction(|tx| {
            // Check if the actor has permission to modify permissions in this domain
            if !self.check_entity_permission_impl(tx, actor_user_id, domain_id, Permission::ManageDomains)? {
                return Err(NetworkError::msg(format!(
                    "User '{}' does not have permission to manage permissions in domain '{}'",
                    actor_user_id, domain_id
                )));
            }

            // Check if the target user exists
            if let Some(mut user) = tx.get_user(target_user_id).cloned() {
                // Get the current permissions for this domain
                let current_permissions = user.permissions
                    .get(domain_id)
                    .cloned()
                    .unwrap_or_default();

                // Update permissions based on operation
                let updated_permissions = match operation {
                    UpdateOperation::Add => {
                        let mut new_permissions = current_permissions;
                        for permission in permissions {
                            new_permissions.insert(permission);
                        }
                        new_permissions
                    }
                    UpdateOperation::Remove => {
                        let mut new_permissions = current_permissions;
                        for permission in permissions {
                            new_permissions.remove(&permission);
                        }
                        new_permissions
                    }
                    UpdateOperation::Replace => {
                        permissions.into_iter().collect()
                    }
                };

                // Update the user's permissions
                user.permissions.insert(domain_id.to_string(), updated_permissions);
                tx.insert_user(target_user_id.to_string(), user)?;

                Ok(())
            } else {
                Err(NetworkError::msg(format!(
                    "Target user '{}' not found",
                    target_user_id
                )))
            }
        })
    }
} 