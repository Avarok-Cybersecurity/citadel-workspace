use crate::kernel::MemberAction;
use crate::kernel::WorkspaceServerKernel;
use crate::structs::{Domain, Permission, User, UserRole};
use citadel_logging::{debug, info};
use citadel_sdk::prelude::{NetworkError, Ratchet};
use crate::handlers::domain::DomainEntity;

pub mod ops;
pub mod permissions;

impl<R: Ratchet> WorkspaceServerKernel<R> {
    pub fn can_access_domain(
        &self,
        user_id: &str,
        entity_id: &str,
        permission: Permission,
    ) -> Result<bool, NetworkError> {
        info!(target: "citadel", "Checking domain access permission for user {} on entity {}", user_id, entity_id);
        self.check_entity_permission(user_id, entity_id, permission)
    }

    pub fn create_user(
        &self,
        admin_id: &str,
        username: &str,
        role: UserRole,
    ) -> Result<(), NetworkError> {
        // Only admins can create users
        if !self.is_admin(admin_id) {
            info!(target: "citadel", "User {} denied admin permission to create new user", admin_id);
            return Err(NetworkError::msg("Only administrators can create users"));
        }

        info!(target: "citadel", "Admin {} creating new user {} with role {:?}", admin_id, username, role);

        let user_id = uuid::Uuid::new_v4().to_string();
        let role_for_log = role.clone(); // Clone role for logging later
        let new_user = User::new(user_id.clone(), username.to_string(), role);

        // Add user to system
        {
            let mut users = self.users.write().unwrap();
            users.insert(user_id.clone(), new_user);
        }

        // Add user to roles
        {
            let mut roles = self.roles.write().unwrap();
            roles.roles.insert(user_id, role_for_log.clone());
        }

        debug!(target: "citadel", "Audit log: Admin {} created user {} with role {:?}", admin_id, username, role_for_log);
        Ok(())
    }

    pub fn add_user_to_domain(
        &self,
        admin_id: &str,
        user_id: &str,
        domain_id: &str,
        role: UserRole,
    ) -> Result<(), NetworkError> {
        // Check if admin has permission to add users
        if !self.is_admin(admin_id)
            && !self.check_entity_permission(admin_id, domain_id, Permission::ManageUsers)?
        {
            info!(target: "citadel", "User {} denied permission to add user {} to domain {}", admin_id, user_id, domain_id);
            return Err(NetworkError::msg(
                "No permission to add users to this domain",
            ));
        }

        info!(target: "citadel", "User {} adding user {} to domain {} with role {:?}", admin_id, user_id, domain_id, role);
        let role_for_log = role.clone(); // Clone role for logging later

        // Add user to domain
        self.with_write_transaction(|tx| {
            tx.add_user_to_domain(user_id, domain_id, role.clone()).map_err(|e| {
                debug!(target: "citadel", "Failed to add user {} to domain {}: {:?}", user_id, domain_id, e);
                e
            })
        })?;

        debug!(target: "citadel", "Audit log: User {} added user {} to domain {} with role {:?}", admin_id, user_id, domain_id, role_for_log);
        Ok(())
    }

    pub fn remove_user_from_domain(
        &self,
        admin_id: &str,
        user_id: &str,
        domain_id: &str,
    ) -> Result<(), NetworkError> {
        // Check if admin has permission to remove users
        if !self.is_admin(admin_id)
            && !self.check_entity_permission(admin_id, domain_id, Permission::ManageUsers)?
        {
            info!(target: "citadel", "User {} denied permission to remove user {} from domain {}", admin_id, user_id, domain_id);
            return Err(NetworkError::msg(
                "No permission to remove users from this domain",
            ));
        }

        info!(target: "citadel", "User {} removing user {} from domain {}", admin_id, user_id, domain_id);

        // Remove user from domain
        self.with_write_transaction(|tx| {
            tx.remove_user_from_domain(user_id, domain_id).map_err(|e| {
                debug!(target: "citadel", "Failed to remove user {} from domain {}: {:?}", user_id, domain_id, e);
                e
            })
        })?;

        debug!(target: "citadel", "Audit log: User {} removed user {} from domain {}", admin_id, user_id, domain_id);
        Ok(())
    }

    pub fn set_user_role(
        &self,
        admin_id: &str,
        user_id: &str,
        role: UserRole,
    ) -> Result<(), NetworkError> {
        // Only admins can set user roles
        if !self.is_admin(admin_id) {
            info!(target: "citadel", "User {} denied admin permission to set role for user {}", admin_id, user_id);
            return Err(NetworkError::msg("Only administrators can set user roles"));
        }

        info!(target: "citadel", "Admin {} setting role {:?} for user {}", admin_id, role, user_id);
        let role_for_user = role.clone(); // Clone for user update
        let role_for_roles = role.clone(); // Clone for roles update
        let role_for_log = role.clone(); // Clone for logging

        // Update user in the system
        {
            let mut users = self.users.write().unwrap();
            if let Some(user) = users.get_mut(user_id) {
                user.role = role_for_user;
            } else {
                return Err(NetworkError::msg("User not found"));
            }
        }

        // Update user in roles
        {
            let mut roles = self.roles.write().unwrap();
            roles.roles.insert(user_id.to_string(), role_for_roles);
        }

        debug!(target: "citadel", "Audit log: Admin {} set role {:?} for user {}", admin_id, role_for_log, user_id);
        Ok(())
    }

    // Helper method to properly update domain members
    pub fn update_domain_members(
        &self,
        domain_id: &str,
        user_id: &str,
        action: MemberAction,
    ) -> Result<(), NetworkError> {
        let mut domains = self.domains.write().unwrap();
        let domain = domains.get_mut(domain_id);

        match domain {
            Some(domain) => match action {
                MemberAction::Add => {
                    // Implement proper member addition logic here based on domain implementation
                    match domain {
                        Domain::Office { office } => {
                            let mut members = office.members.clone();
                            if !members.contains(&user_id.to_string()) {
                                members.push(user_id.to_string());
                                office.members = members;
                            }
                        }
                        Domain::Room { room } => {
                            let mut members = room.members.clone();
                            if !members.contains(&user_id.to_string()) {
                                members.push(user_id.to_string());
                                room.members = members;
                            }
                        }
                    }
                }
                MemberAction::Remove => {
                    // Implement proper member removal logic here
                    match domain {
                        Domain::Office { office } => {
                            let mut members = office.members.clone();
                            members.retain(|id| id != user_id);
                            office.members = members;
                        }
                        Domain::Room { room } => {
                            let mut members = room.members.clone();
                            members.retain(|id| id != user_id);
                            room.members = members;
                        }
                    }
                }
            },
            None => return Err(NetworkError::msg(format!("Domain {} not found", domain_id))),
        }

        Ok(())
    }

    pub fn delete_entity<T: DomainEntity + 'static>(
        &self,
        user_id: &str,
        entity_id: &str,
    ) -> Result<(), NetworkError> {
        // First check if entity exists and user has permission
        let access_permission = match std::any::type_name::<T>() {
            "Office" => Permission::DeleteOffice,
            "Room" => Permission::DeleteRoom,
            _ => Permission::All,
        };

        let has_permission = self.can_access_domain(user_id, entity_id, access_permission)?;

        if !has_permission {
            return Err(NetworkError::Generic(
                "Permission denied: Only owner or admin can delete".into(),
            ));
        }

        // Execute in a write transaction to remove the entity
        self.with_write_transaction(|tx| {
            if tx.get_domain(entity_id).is_some() {
                tx.remove(entity_id)?;
                Ok(())
            } else {
                Err(NetworkError::Generic("Entity not found".into()))
            }
        })
    }

    // Helper method to list members in a specific domain (office or room)
    pub(crate) fn list_members_in_domain(
        &self,
        user_id: &str,
        domain_id: &str,
    ) -> Result<Vec<User>, NetworkError> {
        // Check permission
        self.check_permission(user_id, Some(domain_id), UserRole::Member)?;

        // Get domain
        let domains = self.domains.read().unwrap();
        let domain = domains
            .get(domain_id)
            .ok_or_else(|| NetworkError::msg(format!("Domain {} not found", domain_id)))?;

        // Get members from domain
        let member_ids = domain.members().clone();
        let users = self.users.read().unwrap();

        // Collect users
        let mut members = Vec::new();
        for id in member_ids {
            if let Some(user) = users.get(&id) {
                members.push(user.clone());
            }
        }

        Ok(members)
    }

    // Helper method to check if a user is a member of a domain (office or room)
    pub fn is_member_of_domain(
        &self,
        user_id: &str,
        domain_id: &str,
    ) -> Result<bool, NetworkError> {
        let domains = self.domains.read().unwrap();

        match domains.get(domain_id) {
            Some(domain) => match domain {
                Domain::Office { office } => Ok(office.members.contains(&user_id.to_string())),
                Domain::Room { room } => Ok(room.members.contains(&user_id.to_string())),
            },
            None => Err(NetworkError::msg(format!("Domain {} not found", domain_id))),
        }
    }
}
