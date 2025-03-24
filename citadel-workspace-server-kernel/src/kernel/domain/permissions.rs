use crate::commands::UpdateOperation;
use crate::handlers::permissions::RolePermissions;
use crate::kernel::WorkspaceServerKernel;
use crate::structs::{Domain, Permission, UserRole};
use citadel_logging::{debug, info};
use citadel_sdk::prelude::{NetworkError, Ratchet};
use std::collections::HashSet;

/// Core permission-related functionality for the workspace server
impl<R: Ratchet> WorkspaceServerKernel<R> {
    /// Check if a user has the required role and domain membership (if applicable)
    ///
    /// This is a basic role-based access control check that verifies:
    /// 1. If the user has at least the required role (Admin > Owner > Member)
    /// 2. If the user is a member of the specified domain (when a domain is provided)
    pub fn check_permission(
        &self,
        user_id: &str,
        domain_id: Option<&str>,
        required_role: UserRole,
    ) -> Result<(), NetworkError> {
        // Admins always have permission
        if self.is_admin(user_id) {
            return Ok(());
        }

        let users = self.users.read().unwrap();

        if let Some(user) = users.get(user_id) {
            if user.role >= required_role {
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

    /// Check if a user has a specific permission for a domain entity
    ///
    /// This is a more granular permission check that verifies:
    /// 1. If the user is an admin (admins have all permissions)
    /// 2. If the user has the specific permission granted for the entity
    /// 3. If the user's role in the entity grants the permission implicitly
    pub fn check_entity_permission(
        &self,
        user_id: &str,
        entity_id: &str,
        permission: Permission,
    ) -> Result<bool, NetworkError> {
        // System administrators always have all permissions
        if self.is_admin(user_id) {
            debug!(target: "citadel", "User {} is admin, permission granted for entity {}", user_id, entity_id);
            return Ok(true);
        }

        // Get the user
        let user_has_explicit_permission = {
            let users = self.users.read().unwrap();
            if let Some(user) = users.get(user_id) {
                // Check if user has the specific permission for this entity
                if user.has_permission(entity_id, permission) {
                    debug!(target: "citadel", "User {} has explicit permission {:?} for entity {}", user_id, permission, entity_id);
                    return Ok(true);
                }

                // Store the user role for later use
                user.role.clone()
            } else {
                return Err(NetworkError::msg("User not found"));
            }
        };

        // If not explicitly granted, check based on role and domain membership
        let domains = self.domains.read().unwrap();
        match domains.get(entity_id) {
            Some(Domain::Office { office }) => {
                // Office owners have all permissions for their office
                if office.owner_id == user_id {
                    debug!(target: "citadel", "User {} is owner of office {}, permission granted", user_id, entity_id);
                    return Ok(true);
                }

                // Office members may have some permissions based on role
                if office.members.contains(&user_id.to_string()) {
                    match user_has_explicit_permission {
                        UserRole::Admin => Ok(true), // Admins have all permissions
                        UserRole::Owner => Ok(true), // Owners have all permissions for entities they belong to
                        UserRole::Member => {
                            // Members have limited permissions by default
                            // Use the PermissionSet to determine default permissions based on role
                            let default_perms = user_has_explicit_permission.default_permissions();
                            Ok(default_perms.has(permission))
                        }
                        _ => Ok(false),
                    }
                } else {
                    debug!(target: "citadel", "User {} is not a member of office {}", user_id, entity_id);
                    Ok(false)
                }
            }
            Some(Domain::Room { room }) => {
                // Room owners have all permissions for their room
                if room.owner_id == user_id {
                    debug!(target: "citadel", "User {} is owner of room {}, permission granted", user_id, entity_id);
                    return Ok(true);
                }

                // Room members may have some permissions based on role
                if room.members.contains(&user_id.to_string()) {
                    match user_has_explicit_permission {
                        UserRole::Admin => Ok(true), // Admins have all permissions
                        UserRole::Owner => Ok(true), // Owners have all permissions
                        UserRole::Member => {
                            // Members have limited permissions by default
                            // Use the PermissionSet to determine default permissions based on role
                            let default_perms = user_has_explicit_permission.default_permissions();
                            Ok(default_perms.has(permission))
                        }
                        _ => Ok(false),
                    }
                } else {
                    // For rooms, check if user has permission in parent office
                    let office_id = room.office_id.clone();
                    drop(domains); // Now we can safely drop the domains lock
                    self.check_entity_permission(user_id, &office_id, permission)
                }
            }
            None => {
                debug!(target: "citadel", "Entity {} not found when checking permission for user {}", entity_id, user_id);
                Err(NetworkError::msg("Entity not found"))
            }
        }
    }

    /// Check if a user is an admin
    ///
    /// Centralizes admin checking logic in one place
    pub fn is_admin(&self, user_id: &str) -> bool {
        // First check the roles mapping
        let roles = self.roles.read().unwrap();
        if let Some(role) = roles.roles.get(user_id) {
            if *role == UserRole::Admin {
                debug!(target: "citadel", "User {} has admin role", user_id);
                return true;
            }
        }

        // If not found in roles, check the users map
        let users = self.users.read().unwrap();
        if let Some(user) = users.get(user_id) {
            if user.role == UserRole::Admin {
                debug!(target: "citadel", "User {} has admin role", user_id);
                return true;
            }
        }

        false
    }

    /// Update a member's permissions for a domain
    ///
    /// This method handles adding, removing, or replacing permissions for a user in a domain
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

    /// Set a specific permission for a user in a domain
    ///
    /// This is a simplified version of update_permissions_for_member that handles a single permission
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
            && !self.check_entity_permission(
                admin_id,
                domain_id,
                Permission::ManageOfficeMembers,
            )?
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
