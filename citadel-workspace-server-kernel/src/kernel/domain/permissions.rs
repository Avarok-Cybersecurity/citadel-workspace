use crate::commands::UpdateOperation;
use crate::handlers::permissions::RolePermissions;
use crate::kernel::WorkspaceServerKernel;
use crate::structs::{Domain, Permission, UserRole};
use citadel_logging::debug;
use citadel_sdk::prelude::{NetworkError, Ratchet};

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
        self.with_read_transaction(|tx| {
            // Admins always have permission
            if tx.is_admin(user_id) {
                return Ok(());
            }

            if let Some(user) = tx.get_user(user_id) {
                if user.role >= required_role {
                    // Check domain-specific permissions if a domain is specified
                    if let Some(domain_id) = domain_id {
                        match tx.is_member_of_domain(user_id, domain_id) {
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
        })
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
        self.with_read_transaction(|tx| {
            // System administrators always have all permissions
            if tx.is_admin(user_id) {
                debug!(target: "citadel", "User {} is admin, permission granted for entity {}", user_id, entity_id);
                return Ok(true);
            }

            // Get the user and check their permissions
            let user_role = if let Some(user) = tx.get_user(user_id) {
                // Check if user has the specific permission for this entity
                if user.has_permission(entity_id, permission) {
                    debug!(target: "citadel", "User {} has explicit permission {:?} for entity {}", user_id, permission, entity_id);
                    return Ok(true);
                }

                // Store the user role for later use
                user.role.clone()
            } else {
                return Err(NetworkError::msg("User not found"));
            };

            // If not explicitly granted, check based on role and domain membership
            match tx.get_domain(entity_id) {
                Some(Domain::Office { office }) => {
                    // Office owners have all permissions for their office
                    if office.owner_id == user_id {
                        debug!(target: "citadel", "User {} is owner of office {}, permission granted", user_id, entity_id);
                        return Ok(true);
                    }

                    // Office members may have some permissions based on role
                    if office.members.contains(&user_id.to_string()) {
                        match user_role {
                            UserRole::Admin => Ok(true), // Admins have all permissions
                            UserRole::Owner => Ok(true), // Owners have all permissions for entities they belong to
                            UserRole::Member => {
                                // Members have limited permissions by default
                                // Use the PermissionSet to determine default permissions based on role
                                let default_perms = user_role.default_permissions();
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
                        match user_role {
                            UserRole::Admin => Ok(true), // Admins have all permissions
                            UserRole::Owner => Ok(true), // Owners have all permissions
                            UserRole::Member => {
                                // Members have limited permissions by default
                                // Use the PermissionSet to determine default permissions based on role
                                let default_perms = user_role.default_permissions();
                                Ok(default_perms.has(permission))
                            }
                            _ => Ok(false),
                        }
                    } else {
                        // For rooms, check if user has permission in parent office
                        let office_id = room.office_id.clone();
                        debug!(target: "citadel", "User {} is not a direct member of room {}, checking parent office {}", user_id, entity_id, office_id);
                        // Recursively check permission in the parent office
                        self.check_entity_permission(user_id, &office_id, permission)
                    }
                }
                None => {
                    debug!(target: "citadel", "Entity {} not found when checking permission for user {}", entity_id, user_id);
                    Err(NetworkError::msg("Entity not found"))
                }
            }
        })
    }

    /// Check if a user is an admin
    ///
    /// Centralizes admin checking logic in one place
    pub fn is_admin(&self, user_id: &str) -> bool {
        // First check the roles mapping
        let roles_result = {
            let roles = self.roles.read();
            if let Some(role) = roles.roles.get(user_id) {
                *role == UserRole::Admin
            } else {
                false
            }
        };

        if roles_result {
            debug!(target: "citadel", "User {} has admin role", user_id);
            return true;
        }

        // If not found in roles, check the users via transaction manager
        match self.with_read_transaction(|tx| Ok(tx.is_admin(user_id))) {
            Ok(is_admin) => {
                if is_admin {
                    debug!(target: "citadel", "User {} has admin role", user_id);
                }
                is_admin
            }
            Err(_) => false,
        }
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
            let is_domain_owner = self.with_read_transaction(|tx| {
                if let Some(domain) = tx.get_domain(domain_id) {
                    match domain {
                        Domain::Office { office } => Ok(office.owner_id == user_id),
                        Domain::Room { room } => Ok(room.owner_id == user_id),
                    }
                } else {
                    Err(NetworkError::msg("Domain not found"))
                }
            })?;

            if !is_domain_owner {
                return Err(NetworkError::msg(
                    "Permission denied: You must be an admin or the domain owner to update permissions",
                ));
            }
        }

        // Update the user's permissions
        self.with_write_transaction(|tx| {
            let mut user = if let Some(user) = tx.get_user(member_id).cloned() {
                user
            } else {
                return Err(NetworkError::msg("Member not found"));
            };

            // Check if the member is in the domain
            match tx.is_member_of_domain(member_id, domain_id) {
                Ok(true) => {
                    // Update permissions based on operation
                    match operation {
                        UpdateOperation::Add => {
                            for &perm in permissions {
                                user.add_permission(domain_id, perm);
                            }
                        }
                        UpdateOperation::Remove => {
                            for &perm in permissions {
                                user.revoke_permission(domain_id, perm);
                            }
                        }
                        UpdateOperation::Set => {
                            user.clear_permissions(domain_id);
                            for &perm in permissions {
                                user.add_permission(domain_id, perm);
                            }
                        }
                    }

                    // Save the updated user
                    tx.update_user(member_id, user)?;
                    Ok(())
                }
                Ok(false) => Err(NetworkError::msg("Member is not in the domain")),
                Err(e) => Err(e),
            }
        })
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
        // First check if the admin has permission to do this
        if !self.is_admin(admin_id) {
            let is_domain_owner = self.with_read_transaction(|tx| {
                if let Some(domain) = tx.get_domain(domain_id) {
                    match domain {
                        Domain::Office { office } => Ok(office.owner_id == admin_id),
                        Domain::Room { room } => Ok(room.owner_id == admin_id),
                    }
                } else {
                    Err(NetworkError::msg("Domain not found"))
                }
            })?;

            if !is_domain_owner {
                return Err(NetworkError::msg(
                    "Permission denied: Only admins or domain owners can set permissions",
                ));
            }
        }

        // Now set the permission
        if allow {
            self.update_permissions_for_member(
                admin_id,
                user_id,
                domain_id,
                &[permission],
                UpdateOperation::Add,
            )
        } else {
            self.update_permissions_for_member(
                admin_id,
                user_id,
                domain_id,
                &[permission],
                UpdateOperation::Remove,
            )
        }
    }
}
