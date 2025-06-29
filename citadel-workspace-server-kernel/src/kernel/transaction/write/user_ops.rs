use crate::kernel::transaction::rbac::{retrieve_role_permissions, DomainType};
use crate::kernel::transaction::write::WriteTransaction;
use crate::kernel::transaction::{Transaction, UserChange};
use citadel_sdk::prelude::NetworkError;
use citadel_workspace_types::structs::{Permission, User, UserRole};

impl WriteTransaction<'_> {
    /// Get a user by ID - user management implementation
    pub fn get_user_internal(&self, user_id: &str) -> Option<&User> {
        self.users.get(user_id)
    }

    /// Get a mutable reference to a user - user management implementation
    pub fn get_user_mut_internal(&mut self, user_id: &str) -> Option<&mut User> {
        // Track the change before returning the mutable reference
        if let Some(user) = self.users.get(user_id) {
            self.user_changes
                .push(UserChange::Update(user_id.to_string(), user.clone()));
        }
        self.users.get_mut(user_id)
    }

    /// Get all users in the system - user management implementation
    pub fn get_all_users_internal(&self) -> &std::collections::HashMap<String, User> {
        &self.users
    }

    /// Insert a new user - user management implementation
    pub fn insert_user_internal(
        &mut self,
        user_id: String,
        user: User,
    ) -> Result<(), NetworkError> {
        self.user_changes.push(UserChange::Insert(user_id.clone()));
        self.users.insert(user_id, user);
        Ok(())
    }

    /// Update an existing user - user management implementation
    pub fn update_user_internal(
        &mut self,
        user_id: &str,
        new_user: User,
    ) -> Result<(), NetworkError> {
        let old_user = if let Some(old_user) = self.users.get(user_id) {
            old_user.clone()
        } else {
            return Err(NetworkError::msg(format!(
                "User with id {} not found",
                user_id
            )));
        };

        self.user_changes
            .push(UserChange::Update(user_id.to_string(), old_user));
        self.users.insert(user_id.to_string(), new_user);
        Ok(())
    }

    /// Remove a user - user management implementation
    pub fn remove_user_internal(&mut self, user_id: &str) -> Result<Option<User>, NetworkError> {
        if let Some(old_user) = self.users.get(user_id) {
            let old_user_clone = old_user.clone();
            self.user_changes
                .push(UserChange::Remove(user_id.to_string(), old_user_clone));
            return Ok(self.users.remove(user_id));
        }
        Ok(None)
    }

    /// Get user role - user management implementation
    pub fn get_user_role_internal(&self, user_id: &str) -> Result<Option<UserRole>, NetworkError> {
        Ok(self.users.get(user_id).map(|u| u.role.clone()))
    }

    /// Get permissions for a user - user management implementation
    pub fn get_permissions_internal(
        &self,
        user_id: &str,
        domain_id: Option<&str>,
    ) -> Result<Vec<Permission>, NetworkError> {
        let user = self
            .get_user_internal(user_id)
            .ok_or_else(|| NetworkError::msg(format!("User with id {} not found", user_id)))?;

        // Get base permissions from user's role - default to Workspace domain type
        let role_permissions = retrieve_role_permissions(&user.role, &DomainType::Workspace);

        // Combine with any explicit permissions
        let mut all_permissions = role_permissions;
        // Check if the user has specific permissions for this domain
        if let Some(domain_id) = domain_id {
            if let Some(domain_permissions) = user.get_permissions(domain_id) {
                all_permissions.extend(domain_permissions.iter().cloned());
            }
        }

        Ok(all_permissions)
    }

    /// Get a role by ID - user management implementation
    pub fn get_role_internal(&self, role_id: &str) -> Result<Option<UserRole>, NetworkError> {
        // Simple implementation that maps string role IDs to Role enum
        match role_id {
            "admin" => Ok(Some(UserRole::Admin)),
            "member" => Ok(Some(UserRole::Member)),
            "guest" => Ok(Some(UserRole::Guest)),
            _ => Ok(None),
        }
    }

    /// Create a new role (placeholder implementation) - user management implementation
    pub fn create_role_internal(&mut self, _role: UserRole) -> Result<(), NetworkError> {
        // This is a placeholder since we're using an enum for roles
        Ok(())
    }

    /// Delete a role (placeholder implementation) - user management implementation
    pub fn delete_role_internal(&mut self, _role_id: &str) -> Result<(), NetworkError> {
        // This is a placeholder since we're using an enum for roles
        Ok(())
    }

    /// Assign a role to a user - user management implementation
    pub fn assign_role_internal(
        &mut self,
        user_id: &str,
        role_id: &str,
    ) -> Result<(), NetworkError> {
        let mut user = self
            .get_user(user_id)
            .ok_or_else(|| NetworkError::msg(format!("User with id {} not found", user_id)))?
            .clone();

        // Parse role_id to UserRole
        let new_role = match role_id {
            "admin" => UserRole::Admin,
            "owner" => UserRole::Owner,
            "member" => UserRole::Member,
            "guest" => UserRole::Guest,
            "banned" => UserRole::Banned,
            _ => return Err(NetworkError::msg(format!("Unknown role: {}", role_id))),
        };

        // Store old role for history tracking
        let _old_role = user.role.clone();

        // Assign new role
        user.role = new_role;

        // Note: We don't need to add a specific RoleChange here because the user change will capture this

        Ok(())
    }

    pub fn unassign_role_internal(
        &mut self,
        user_id: &str,
        role_id: &str,
    ) -> Result<(), NetworkError> {
        // In our model, unassigning a role means setting the role to None
        let mut user = self
            .get_user(user_id)
            .ok_or_else(|| NetworkError::msg(format!("User with id {} not found", user_id)))?
            .clone();

        // Only unassign if the user has the specified role
        let current_role_id = match user.role {
            UserRole::Admin => "admin",
            UserRole::Owner => "owner",
            UserRole::Member => "member",
            UserRole::Guest => "guest",
            UserRole::Banned => "banned",
            UserRole::Custom(ref name, _) => {
                return Err(NetworkError::msg(format!(
                    "Cannot unassign custom role {} from user",
                    name
                )))
            }
        };

        if current_role_id != role_id {
            return Err(NetworkError::msg(format!(
                "Cannot unassign role {} from user with role {}",
                role_id, current_role_id
            )));
        }

        // Set role to Guest (lowest standard permission level)
        user.role = UserRole::Guest;

        // Update user in storage
        self.users.insert(user_id.to_string(), user);

        Ok(())
    }
}
