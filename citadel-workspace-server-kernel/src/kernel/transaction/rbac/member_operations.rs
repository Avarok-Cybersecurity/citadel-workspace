use crate::kernel::transaction::{Transaction, TransactionManager};
use citadel_logging::debug;
use citadel_sdk::prelude::NetworkError;
use citadel_workspace_types::structs::{Permission, User, UserRole};
use citadel_workspace_types::UpdateOperation;

impl TransactionManager {
    /// Get a member by ID
    pub fn get_member(&self, user_id: &str, member_id: &str) -> Result<Option<User>, NetworkError> {
        self.with_read_transaction(|tx| {
            if !self.is_admin(user_id) {
                return Err(NetworkError::msg(
                    "Only administrators can view member details".to_string(),
                ));
            }
            Ok(tx.get_user(member_id).cloned())
        })
    }

    /// Update a member's role
    pub fn update_member_role(
        &self,
        user_id: &str,
        member_id: &str,
        role: UserRole,
    ) -> Result<(), NetworkError> {
        self.with_write_transaction(|tx| {
            if !self.is_admin(user_id) {
                return Err(NetworkError::msg(
                    "Only administrators can update member roles".to_string(),
                ));
            }

            let _member = tx.get_user(member_id).ok_or_else(|| {
                NetworkError::msg(format!("Member with id {} not found", member_id))
            })?;

            if _member.role == UserRole::Admin {
                return Err(NetworkError::msg(
                    "Cannot update role of the admin user".to_string(),
                ));
            }

            let role_str = match role {
                UserRole::Admin => "admin",
                UserRole::Owner => "owner",
                UserRole::Member => "member",
                UserRole::Guest => "guest",
                UserRole::Banned => "banned",
                UserRole::Custom(_name, _) => "custom",
            };
            tx.assign_role(member_id, role_str)
        })
    }

    /// Update a member's permissions
    pub fn update_member_permissions(
        &self,
        user_id: &str,
        member_id: &str,
        domain_id: &str,
        permissions: Vec<Permission>,
        modify_type: UpdateOperation,
    ) -> Result<(), NetworkError> {
        self.with_write_transaction(|tx| {
            if !self.check_entity_permission_with_tx(tx, user_id, domain_id, Permission::ManageDomains)? {
                return Err(NetworkError::msg(format!(
                    "User {} does not have permission to update permissions in domain {}",
                    user_id, domain_id
                )));
            }

            tx.get_user(member_id).ok_or_else(|| {
                NetworkError::msg(format!("Member with id {} not found", member_id))
            })?;

            let member_mut = tx.get_user_mut(member_id).unwrap();

            match modify_type {
                UpdateOperation::Add => {
                    for permission in permissions {
                        debug!(target: "citadel", "Adding permission {:?} for user {} in domain {}", permission, member_id, domain_id);
                        member_mut.add_permission(domain_id, permission);
                    }
                }
                UpdateOperation::Remove => {
                    for permission in permissions {
                        debug!(target: "citadel", "Removing permission {:?} for user {} in domain {}", permission, member_id, domain_id);
                        member_mut.revoke_permission(domain_id, permission);
                    }
                }
                UpdateOperation::Set => {
                    debug!(target: "citadel", "Setting permissions {:?} for user {} in domain {}", permissions, member_id, domain_id);
                    member_mut.clear_permissions(domain_id);

                    for permission in permissions {
                        member_mut.grant_permission(domain_id, permission);
                    }
                }
            }

            Ok(())
        })
    }

    /// Completely deletes a member from the workspace, including all offices, rooms, etc
    pub fn delete_member(&self, user_id: &str, member_id: &str) -> Result<(), NetworkError> {
        self.with_write_transaction(|tx| {
            if !self.is_admin(user_id) {
                return Err(NetworkError::msg(
                    "Only administrators can delete members".to_string(),
                ));
            }

            let _member = tx.get_user(member_id).ok_or_else(|| {
                NetworkError::msg(format!("Member with id {} not found", member_id))
            })?;

            if _member.role == UserRole::Admin {
                return Err(NetworkError::msg(
                    "Cannot delete the admin user".to_string(),
                ));
            }

            let domains: Vec<String> = tx.get_user(member_id)
                .map(|user| {
                    user.permissions
                        .keys()
                        .map(|k| k.to_string())
                        .collect()
                })
                .unwrap_or_default();

            for domain_id in domains {
                if let Err(e) = tx.remove_user_from_domain_internal(member_id, &domain_id) {
                    debug!(target: "citadel", "Error removing user from domain {}: {:?}", domain_id, e);
                }
            }

            tx.remove_user_internal(member_id)?;
            Ok(())
        })
    }
}
