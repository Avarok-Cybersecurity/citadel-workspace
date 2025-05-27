use crate::kernel::transaction::read::ReadTransaction;
use crate::kernel::transaction::write::WriteTransaction;
use crate::kernel::transaction::{Transaction, TransactionManager};
use citadel_logging::debug;
use citadel_sdk::prelude::NetworkError;
use citadel_workspace_types::structs::{Domain, Permission, User, UserRole};
use citadel_workspace_types::UpdateOperation;

impl TransactionManager {
    pub fn is_admin(&self, user_id: &str) -> bool {
        self.with_read_transaction(|tx| {
            Ok(tx
                .get_user(user_id)
                .map(|u| u.role == UserRole::Admin)
                .unwrap_or(false))
        })
        .unwrap_or(false)
    }

    /// Internal logic for checking entity permission, operating on an existing transaction.
    pub fn check_entity_permission_with_tx(
        &self,
        tx: &dyn Transaction,
        user_id: &str,
        entity_id: &str,
        permission: Permission,
    ) -> Result<bool, NetworkError> {
        // System administrators always have all permissions
        if tx
            .get_user(user_id)
            .map(|u| u.role == UserRole::Admin)
            .unwrap_or(false)
        {
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
            return Err(NetworkError::msg(format!(
                "User '{}' not found in check_entity_permission_with_tx",
                user_id
            )));
        };

        // If not explicitly granted, check based on role and domain membership
        match tx.get_domain(entity_id) {
            Some(Domain::Workspace { workspace }) => {
                // Workspace owners have all permissions for their workspace
                if workspace.owner_id == user_id {
                    debug!(target: "citadel", "User {} is owner of workspace {}, permission granted", user_id, entity_id);
                    return Ok(true);
                }

                // Workspace members may have some permissions based on role
                if workspace.members.contains(&user_id.to_string()) {
                    // Admins and owners have all permissions of a given domain
                    Ok(matches!(user_role, UserRole::Admin | UserRole::Owner))
                } else {
                    Ok(false)
                }
            }
            Some(Domain::Office { office }) => {
                // Office owners have all permissions for their office
                if office.owner_id == user_id {
                    debug!(target: "citadel", "User {} is owner of office {}, permission granted", user_id, entity_id);
                    return Ok(true);
                }

                // Office members may have some permissions based on role
                if office.members.contains(&user_id.to_string()) {
                    // Admins and owners have all permissions of a given domain
                    Ok(matches!(user_role, UserRole::Admin | UserRole::Owner))
                } else {
                    // Check if the user has permissions via a parent workspace
                    // Try to find which workspace contains this office
                    for workspace_candidate in tx.get_all_workspaces().values() {
                        if workspace_candidate.offices.contains(&office.id)
                            && (workspace_candidate.owner_id == user_id
                                || workspace_candidate.members.contains(&user_id.to_string()))
                        {
                            // User is a member of the parent workspace - check role permissions
                            // Admins and owners have all permissions of a given domain
                            return Ok(matches!(user_role, UserRole::Admin | UserRole::Owner));
                        }
                    }
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
                    // Admins and owners have all permissions of a given domain
                    Ok(matches!(user_role, UserRole::Admin | UserRole::Owner))
                } else {
                    // Check if the user has permissions via the parent office
                    // First get the parent office
                    if let Some(Domain::Office { office }) = tx.get_domain(&room.office_id) {
                        if office.owner_id == user_id
                            || office.members.contains(&user_id.to_string())
                        {
                            // User is a member of the parent office - check role permissions
                            // Admins and owners have all permissions of a given domain
                            return Ok(matches!(user_role, UserRole::Admin | UserRole::Owner));
                        }
                        // If not a member of the direct parent office, check if they are a member of the workspace containing this office's parent
                        for workspace_candidate in tx.get_all_workspaces().values() {
                            if workspace_candidate.offices.contains(&office.id)
                                && (workspace_candidate.owner_id == user_id
                                    || workspace_candidate.members.contains(&user_id.to_string()))
                            {
                                return Ok(matches!(user_role, UserRole::Admin | UserRole::Owner));
                            }
                        }
                    }
                    Ok(false)
                }
            }
            None => {
                // Entity not found, so no permissions can be granted.
                // This case should ideally be handled before calling check_entity_permission
                // or result in a specific "entity not found" error if that's more appropriate.
                // For a boolean permission check, false is correct if entity doesn't exist.
                debug!(target: "citadel", "Entity {} not found, permission denied for user {}", entity_id, user_id);
                Ok(false)
            }
        }
    }

    /// Check if a user has a specific permission for a domain entity
    ///
    /// This is a more granular permission check that verifies:
    /// 1. If the user is an admin (admins have all permissions)
    /// 2. If the user has the specific permission granted for the entity
    /// 3. If the user's role in the entity grants the permission implicitly
    /// 4. For hierarchical domains, checks parent domains for permissions
    pub fn check_entity_permission(
        &self,
        user_id: &str,
        entity_id: &str,
        permission: Permission,
    ) -> Result<bool, NetworkError> {
        self.with_read_transaction(|tx| {
            self.check_entity_permission_with_tx(tx, user_id, entity_id, permission)
        })
    }

    pub fn get_member(&self, user_id: &str, member_id: &str) -> Result<Option<User>, NetworkError> {
        self.check_entity_permission(user_id, member_id, Permission::ViewContent)?;
        self.with_read_transaction(|tx| Ok(tx.get_user(member_id).cloned()))
    }

    pub fn update_member_role(
        &self,
        user_id: &str,
        member_id: &str,
        role: UserRole,
    ) -> Result<(), NetworkError> {
        // Check if the calling user is an admin
        if !self.is_admin(user_id) {
            return Err(NetworkError::msg(format!(
                "Permission denied: User {} is not an admin",
                user_id
            )));
        }

        self.with_write_transaction(|tx| {
            // Get the target member mutably and check if they exist
            let target_member = tx
                .get_user_mut(member_id)
                .ok_or_else(|| NetworkError::msg(format!("Target user {} not found", member_id)))?;

            target_member.role = role;
            Ok(())
        })
    }

    pub fn update_member_permissions(
        &self,
        user_id: &str,
        member_id: &str,
        domain_id: &str,
        permissions: Vec<Permission>,
        modify_type: UpdateOperation,
    ) -> Result<(), NetworkError> {
        self.check_entity_permission(user_id, member_id, Permission::AddUsers)?;
        self.with_write_transaction(|tx| {
            let member = tx
                .get_user_mut(user_id)
                .ok_or_else(|| NetworkError::msg("User not found"))?;
            let current_permission = member
                .permissions
                .get_mut(domain_id)
                .ok_or_else(|| NetworkError::msg("Domain not found"))?;
            match modify_type {
                UpdateOperation::Add => {
                    current_permission.extend(permissions);
                }
                UpdateOperation::Set => {
                    *current_permission = permissions.into_iter().collect();
                }
                UpdateOperation::Remove => {
                    current_permission.retain(|permission| !permissions.contains(permission));
                }
            }
            Ok(())
        })
    }

    /// Completely deletes a member from the workspace, including all offices, rooms, etc
    pub fn delete_member(&self, user_id: &str, member_id: &str) -> Result<(), NetworkError> {
        self.check_entity_permission(user_id, member_id, Permission::AddUsers)?;
        self.with_write_transaction(|tx| {
            let user = tx
                .remove_user(user_id)?
                .ok_or_else(|| NetworkError::msg("User not found for deletion"))?;
            let domain_memberships = user.permissions.keys();
            for domain_id in domain_memberships {
                let _ = tx.remove_user_from_domain(user_id, domain_id);
            }
            Ok(())
        })
    }
}

impl TransactionManager {
    /// Create a new read transaction
    pub fn read_transaction(&self) -> ReadTransaction {
        ReadTransaction::new(
            self.domains.read(),
            self.users.read(),
            self.workspaces.read(),
            self.workspace_password.read(),
        )
    }

    /// Create a new write transaction
    pub fn write_transaction(&self) -> WriteTransaction {
        WriteTransaction::new(
            self.domains.write(),
            self.users.write(),
            self.workspaces.write(),
            self.workspace_password.write(),
        )
    }

    /// Execute a function with a read transaction
    pub fn with_read_transaction<F, T>(&self, f: F) -> Result<T, NetworkError>
    where
        F: FnOnce(&dyn Transaction) -> Result<T, NetworkError>,
    {
        let tx = self.read_transaction();
        f(&tx)
    }

    /// Execute a function with a write transaction
    pub fn with_write_transaction<F, T>(&self, f: F) -> Result<T, NetworkError>
    where
        F: FnOnce(&mut dyn Transaction) -> Result<T, NetworkError>,
    {
        let mut tx = self.write_transaction();
        match f(&mut tx) {
            Ok(result) => {
                tx.commit()?;
                Ok(result)
            }
            Err(e) => {
                // Attempt to rollback, explicitly ignoring the result as per warning
                let _ = tx.rollback();
                Err(e)
            }
        }
    }
}
