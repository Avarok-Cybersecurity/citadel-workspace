use citadel_sdk::prelude::{NetworkError, Ratchet};
use std::collections::{HashMap, HashSet};

use crate::kernel::WorkspaceServerKernel;
use crate::structs::{Domain, Permission, User, UserRole};

// Member handlers - functions for adding, removing, and updating workspace members
impl<R: Ratchet> WorkspaceServerKernel<R> {
    pub fn add_member(
        &self,
        admin_id: &str,
        user_id: &str,
        office_id: Option<&str>,
        room_id: Option<&str>,
        role: UserRole,
    ) -> Result<(), NetworkError> {
        // Check if admin has permission
        if !self.is_admin(admin_id) {
            return Err(NetworkError::msg(
                "Permission denied: Only admins can add members",
            ));
        }

        // Check if user exists, if not create a new user
        let mut users = self.users.write();
        if !users.contains_key(user_id) {
            users.insert(
                user_id.to_string(),
                User {
                    id: user_id.to_string(),
                    name: format!("User {}", user_id),
                    role,
                    permissions: HashMap::new(),
                },
            );
        } else {
            // Update role if user exists
            if let Some(user) = users.get_mut(user_id) {
                user.role = role;
            }
        }
        drop(users);

        let mut domains = self.domains.write();

        // Add to office if specified
        if let Some(office_id) = office_id {
            match domains.get_mut(office_id) {
                Some(Domain::Office { office }) => {
                    if !office.members.contains(&user_id.to_string()) {
                        office.members.push(user_id.to_string());
                    }
                }
                _ => return Err(NetworkError::msg("Office not found")),
            }

            // Add relevant permissions for the office
            self.grant_domain_permissions(user_id, office_id)?;
        }

        // Add to room if specified
        if let Some(room_id) = room_id {
            match domains.get_mut(room_id) {
                Some(Domain::Room { room }) => {
                    if !room.members.contains(&user_id.to_string()) {
                        room.members.push(user_id.to_string());
                    }
                }
                _ => return Err(NetworkError::msg("Room not found")),
            }

            // Add relevant permissions for the room
            self.grant_domain_permissions(user_id, room_id)?;
        }

        Ok(())
    }

    pub fn remove_member(
        &self,
        admin_id: &str,
        user_id: &str,
        office_id: Option<&str>,
        room_id: Option<&str>,
    ) -> Result<(), NetworkError> {
        // Check if admin has permission
        if !self.is_admin(admin_id) {
            return Err(NetworkError::msg(
                "Permission denied: Only admins can remove members",
            ));
        }

        let mut domains = self.domains.write();

        // Remove from office if specified
        if let Some(office_id) = office_id {
            match domains.get_mut(office_id) {
                Some(Domain::Office { office }) => {
                    office.members.retain(|id| id != user_id);
                }
                _ => return Err(NetworkError::msg(format!("Office {} not found", office_id))),
            }

            // Revoke permissions for the office
            self.revoke_domain_permissions(user_id, office_id)?;
        }

        // Remove from room if specified
        if let Some(room_id) = room_id {
            match domains.get_mut(room_id) {
                Some(Domain::Room { room }) => {
                    room.members.retain(|id| id != user_id);
                }
                _ => return Err(NetworkError::msg(format!("Room {} not found", room_id))),
            }

            // Revoke permissions for the room
            self.revoke_domain_permissions(user_id, room_id)?;
        }

        Ok(())
    }

    pub fn update_member_role(
        &self,
        admin_id: &str,
        user_id: &str,
        role: UserRole,
    ) -> Result<User, NetworkError> {
        // Check if admin has permission
        if !self.is_admin(admin_id) {
            return Err(NetworkError::msg(
                "Permission denied: Only admins can update member roles",
            ));
        }

        let mut users = self.users.write();

        match users.get_mut(user_id) {
            Some(user) => {
                user.role = role;
                Ok(user.clone())
            }
            None => Err(NetworkError::msg("User not found")),
        }
    }

    pub fn update_member_permissions(
        &self,
        admin_id: &str,
        user_id: &str,
        domain_id: &str,
        permissions: Vec<Permission>,
        operation: crate::commands::PermissionEndowOperation,
    ) -> Result<User, NetworkError> {
        // Check if admin has permission
        if !self.is_admin(admin_id) {
            return Err(NetworkError::msg(
                "Permission denied: Only admins can update member permissions",
            ));
        }

        // Check if domain exists
        {
            let domains = self.domains.read();
            if !domains.contains_key(domain_id) {
                return Err(NetworkError::msg("Domain not found"));
            }
        }

        let mut users = self.users.write();

        match users.get_mut(user_id) {
            Some(user) => {
                // Perform the requested permission operation
                match operation {
                    crate::commands::PermissionEndowOperation::Add => {
                        // Initialize the permissions HashSet if it doesn't exist
                        let perms = user
                            .permissions
                            .entry(domain_id.to_string())
                            .or_insert_with(HashSet::new);

                        // Add all the permissions
                        for perm in permissions {
                            perms.insert(perm);
                        }
                    }
                    crate::commands::PermissionEndowOperation::Remove => {
                        // Remove the specified permissions if the domain exists
                        if let Some(perms) = user.permissions.get_mut(domain_id) {
                            for perm in permissions {
                                perms.remove(&perm);
                            }
                        }
                    }
                    crate::commands::PermissionEndowOperation::Replace => {
                        // Replace all permissions with the new set
                        let mut new_perms = HashSet::new();
                        for perm in permissions {
                            new_perms.insert(perm);
                        }
                        user.permissions.insert(domain_id.to_string(), new_perms);
                    }
                }

                Ok(user.clone())
            }
            None => Err(NetworkError::msg("User not found")),
        }
    }

    pub fn get_member(&self, user_id: &str) -> Option<User> {
        let users = self.users.read();
        users.get(user_id).cloned()
    }

    // Helper methods for permission management
    fn grant_domain_permissions(&self, user_id: &str, domain_id: &str) -> Result<(), NetworkError> {
        let mut users = self.users.write();

        if let Some(user) = users.get_mut(user_id) {
            // Grant basic permissions based on the domain type
            let domains = self.domains.read();

            match domains.get(domain_id) {
                Some(Domain::Office { .. }) => {
                    let permissions = user
                        .permissions
                        .entry(domain_id.to_string())
                        .or_insert_with(HashSet::new);

                    // Grant basic office permissions
                    permissions.insert(Permission::EditMdx);
                }
                Some(Domain::Room { .. }) => {
                    let permissions = user
                        .permissions
                        .entry(domain_id.to_string())
                        .or_insert_with(HashSet::new);

                    // Grant basic room permissions
                    permissions.insert(Permission::EditMdx);
                }
                None => return Err(NetworkError::msg("Domain not found")),
            }

            Ok(())
        } else {
            Err(NetworkError::msg("User not found"))
        }
    }

    fn revoke_domain_permissions(
        &self,
        user_id: &str,
        domain_id: &str,
    ) -> Result<(), NetworkError> {
        let mut users = self.users.write();

        if let Some(user) = users.get_mut(user_id) {
            // Remove all permissions for this domain
            user.permissions.remove(domain_id);
            Ok(())
        } else {
            Err(NetworkError::msg("User not found"))
        }
    }
}
