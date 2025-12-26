use crate::kernel::transaction::rbac::DomainType;
use crate::kernel::transaction::{Transaction, TransactionManager};
use crate::WORKSPACE_ROOT_ID;
use citadel_logging::{debug, error};
use citadel_sdk::prelude::NetworkError;
use citadel_workspace_types::structs::{Permission, UserRole};

impl TransactionManager {
    /// Internal logic for checking entity permission, operating on an existing transaction.
    pub fn check_entity_permission_with_tx(
        &self,
        tx: &dyn Transaction,
        user_id: &str,
        entity_id: &str,
        permission: Permission,
    ) -> Result<bool, NetworkError> {
        Self::check_entity_permission_with_tx_static(tx, user_id, entity_id, permission)
    }

    /// Static version of permission check to avoid self-recursion warning
    fn check_entity_permission_with_tx_static(
        tx: &dyn Transaction,
        user_id: &str,
        entity_id: &str,
        permission: Permission,
    ) -> Result<bool, NetworkError> {
        debug!(target: "citadel", "[RBAC_ENTRY_LOG] ENTERING check_entity_permission_with_tx. User: {}, Entity: {}, Permission: {:?}", user_id, entity_id, permission);

        let admin_check_user = tx.get_user(user_id);

        let is_admin_by_role = admin_check_user
            .map(|u| u.role == UserRole::Admin)
            .unwrap_or(false);

        if is_admin_by_role {
            return Ok(true);
        }

        let user_role = if let Some(user) = tx.get_user(user_id) {
            if user.has_permission(entity_id, permission) {
                return Ok(true);
            }

            user.role.clone()
        } else {
            error!(target: "citadel", "User with id {} not found", user_id);
            return Err(NetworkError::msg(format!(
                "User with id {} not found",
                user_id
            )));
        };

        if entity_id == WORKSPACE_ROOT_ID {
            let role_permissions =
                super::retrieve_role_permissions(&user_role, &DomainType::Workspace);

            let has_permission = role_permissions.contains(&permission);
            return Ok(has_permission);
        }

        if let Some(domain) = tx.get_domain(entity_id) {
            let domain_type = if domain.as_office().is_some() {
                DomainType::Office
            } else if domain.as_room().is_some() {
                DomainType::Room
            } else if domain.as_workspace().is_some() {
                DomainType::Workspace
            } else {
                error!(target: "citadel", "Unknown domain type for domain: {}", entity_id);
                return Err(NetworkError::msg(format!(
                    "Unknown domain type for domain: {}",
                    entity_id
                )));
            };

            // Check if user is the owner of the domain - owners have full permissions
            let is_owner = domain.owner_id() == user_id;
            if is_owner {
                debug!(target: "citadel", "[RBAC] User {} is owner of domain {}, granting all permissions", user_id, entity_id);
                return Ok(true);
            }

            let is_member = domain
                .members()
                .iter()
                .any(|member_id| member_id == user_id);
            let user_role_in_domain = if is_member {
                Some(UserRole::Member)
            } else {
                None
            };

            if let Some(role) = user_role_in_domain {
                let role_permissions = super::retrieve_role_permissions(&role, &domain_type);

                let has_permission = role_permissions.contains(&permission);

                if has_permission {
                    return Ok(true);
                }
            }

            let parent_id = domain.parent_id();
            if !parent_id.is_empty() {
                return Self::check_entity_permission_with_tx_static(
                    tx, user_id, parent_id, permission,
                );
            }
        }

        Ok(false)
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
}
