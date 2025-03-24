use crate::commands::UpdateOperation;
use crate::handlers::domain_ops::DomainOperations;
use crate::kernel::WorkspaceServerKernel;
use crate::structs::{Domain, Permission, UserRole};
use citadel_logging::{debug, info};
use citadel_sdk::prelude::{NetworkError, Ratchet};
use std::collections::HashSet;

impl<R: Ratchet> WorkspaceServerKernel<R> {
    // Helper methods for permission checking
    pub fn check_permission(
        &self,
        user_id: &str,
        domain_id: Option<&str>,
        required_role: UserRole,
    ) -> Result<(), NetworkError> {
        let users = self.users.read().unwrap();

        if let Some(user) = users.get(user_id) {
            if user.role == UserRole::Admin || user.role >= required_role {
                // Check domain-specific permissions if a domain is specified
                if let Some(domain_id) = domain_id {
                    match self.is_member_of_domain(user_id, domain_id) {
                        Ok(is_member) if is_member => return Ok(()),
                        Ok(_) => {}
                        Err(e) => return Err(e),
                    }
                } else {
                    return Ok(());
                }
            } else {
                return Err(NetworkError::msg(
                    "Permission denied: Insufficient privileges",
                ));
            }
        } else {
            return Err(NetworkError::msg("User not found"));
        }

        Err(NetworkError::msg(
            "Permission denied: Not a member of the domain",
        ))
    }

    pub fn is_admin(&self, user_id: &str) -> bool {
        let roles = self.roles.read().unwrap();
        match roles.roles.get(user_id) {
            Some(role) if *role == UserRole::Admin => {
                debug!(target: "citadel", "User {} has admin role", user_id);
                true
            }
            _ => false,
        }
    }

    // Update a member's permissions for a domain (kernel implementation)
    pub fn update_permissions_for_member(
        &self,
        user_id: &str,
        member_id: &str,
        domain_id: &str,
        permissions: &[Permission],
        operation: UpdateOperation,
    ) -> Result<(), NetworkError> {
        // Check if the requesting user is an admin or the owner of the domain
        if !self.is_admin(user_id) {
            let domains = self.domains.read().unwrap();
            match domains.get(domain_id) {
                Some(Domain::Office { office }) => {
                    if office.owner_id != user_id {
                        return Err(NetworkError::msg(
                            "Permission denied: You must be an admin or the domain owner to update permissions",
                        ));
                    }
                }
                Some(Domain::Room { room }) => {
                    if room.owner_id != user_id {
                        return Err(NetworkError::msg(
                            "Permission denied: You must be an admin or the domain owner to update permissions",
                        ));
                    }
                }
                _ => return Err(NetworkError::msg("Domain not found")),
            }
        }

        // Get the user and update their permissions
        let mut users = self.users.write().unwrap();
        let user = users
            .get_mut(member_id)
            .ok_or_else(|| NetworkError::msg("User not found"))?;

        // Initialize domain permissions if they don't exist
        if !user.permissions.contains_key(domain_id) {
            user.permissions
                .insert(domain_id.to_string(), HashSet::new());
        }

        // Get the permission set for this domain
        let domain_permissions = user.permissions.get_mut(domain_id).unwrap();

        // Apply the permission operation
        match operation {
            UpdateOperation::Add => {
                // Add all permissions to the set
                for permission in permissions {
                    domain_permissions.insert(*permission);
                }
            }
            UpdateOperation::Remove => {
                // Remove specified permissions from the set
                for permission in permissions {
                    domain_permissions.remove(permission);
                }
            }
            UpdateOperation::Set => {
                // Replace existing permissions with the new set
                domain_permissions.clear();
                for permission in permissions {
                    domain_permissions.insert(*permission);
                }
            }
        }

        debug!(target: "citadel", "Audit log: User {} updated permissions for user {} in domain {}", user_id, member_id, domain_id);
        Ok(())
    }

    pub fn set_domain_permission(
        &self,
        admin_id: &str,
        domain_id: &str,
        user_id: &str,
        permission: Permission,
        allow: bool,
    ) -> Result<(), NetworkError> {
        // Check if admin has permission to manage permissions
        if !self.is_admin(admin_id)
            && !self.check_entity_permission(admin_id, domain_id, Permission::ManageUsers)?
        {
            info!(target: "citadel", "User {} denied permission to set permissions for domain {}", admin_id, domain_id);
            return Err(NetworkError::msg(
                "No permission to manage permissions for this domain",
            ));
        }

        info!(target: "citadel", "User {} {}granting permission {:?} to user {} for domain {}",
            admin_id, if allow { "" } else { "removing/" }, permission, user_id, domain_id);

        // Update domain permissions
        self.with_write_transaction(|tx| {
            if let Some(domain) = tx.get_domain(domain_id).cloned() {
                // Get the user from the system
                let mut users = self.users.write().unwrap();
                if let Some(user) = users.get_mut(user_id) {
                    let mut user_permissions =
                        user.get_permissions(domain_id).cloned().unwrap_or_default();

                    // Update permission
                    if allow {
                        user_permissions.insert(permission);
                    } else {
                        user_permissions.remove(&permission);
                    }

                    // Update user's permissions for this domain
                    user.permissions
                        .insert(domain_id.to_string(), user_permissions);

                    // Save updated domain
                    tx.update(domain_id, domain)
                } else {
                    Err(NetworkError::msg("User not found"))
                }
            } else {
                Err(NetworkError::msg("Domain not found"))
            }
        })?;

        debug!(target: "citadel", "Audit log: User {} {}granted permission {:?} to user {} for domain {}",
            admin_id, if allow { "" } else { "removed/" }, permission, user_id, domain_id);
        Ok(())
    }
}
