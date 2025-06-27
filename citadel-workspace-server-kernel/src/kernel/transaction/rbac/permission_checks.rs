use crate::kernel::transaction::{Transaction, TransactionManager};
use crate::kernel::transaction::rbac::DomainType;
use crate::WORKSPACE_ROOT_ID;
use citadel_logging::{debug, error, info};
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
        debug!(target: "citadel", "[RBAC_ENTRY_LOG] ENTERING check_entity_permission_with_tx. User: {}, Entity: {}, Permission: {:?}", user_id, entity_id, permission);

        // Log user retrieval attempt for ANY user during the critical path
        let user_opt_for_log = tx.get_user(user_id);
        debug!(target: "citadel",
            "[RBAC_ATTEMPT_GET_USER] In Read TX for entity '{}', perm '{:?}'. Attempting to get user '{}': Found: {}",
            entity_id, permission, user_id, user_opt_for_log.is_some()
        );
        if let Some(user_obj_for_log) = user_opt_for_log {
            if user_id == "test_user" {
                // Only print permissions map for test_user to reduce noise
                println!("[RBAC_ATTEMPT_GET_USER_DETAIL_TEST_USER_PRINTLN] User '{}' found. Permissions map: {:?}", user_id, user_obj_for_log.permissions);
            }
        }

        // System administrators always have all permissions
        let admin_check_user = tx.get_user(user_id);

        // Logging for test user
        if user_id == "admin" {
            info!(target: "citadel", "[RBAC_CHECK_TEST_USER] Retrieved user for 'test_user': {:?}", user_opt_for_log.is_some());
            if let Some(user_details) = admin_check_user.as_ref() {
                info!(target: "citadel", "[RBAC_CHECK_TEST_USER] 'test_user' details: Role: {:?}, Permissions map: {:?}", user_details.role, user_details.permissions);
            }
        }

        let is_admin_by_role = admin_check_user
            .map(|u| u.role == UserRole::Admin)
            .unwrap_or(false);
        debug!(target: "citadel", "[ADMIN_CHECK_DETAIL] Value of is_admin_by_role (just before if): {}", is_admin_by_role);

        if is_admin_by_role {
            // Admin has permission
            return Ok(true);
        }
        debug!(target: "citadel", "[ADMIN_CHECK_DETAIL] User {} is NOT admin by role OR the admin block was not entered. Proceeding with other checks.", user_id);

        // Get the user and check their permissions
        let user_role = if let Some(user) = tx.get_user(user_id) {
            // Workspace root ID specific logging
            if entity_id == WORKSPACE_ROOT_ID {
                println!("[DEBUG_WORKSPACE_ROOT_CHECK_PRINTLN] User: '{}', Entity_ID: '{}' (is WORKSPACE_ROOT_ID), Checking Perm: {:?}. User's FULL permissions map in this Read TX: {:?}", user_id, entity_id, permission, user.permissions);
                let specific_perms = user.permissions.get(entity_id);
                println!("[DEBUG_WORKSPACE_ROOT_CHECK_DETAIL_PRINTLN] Lookup for WORKSPACE_ROOT_ID ('{}') in user's map: {:?}. Contains {:?}: {}", entity_id, specific_perms, permission, specific_perms.is_some_and(|s| s.contains(&permission)));
            }

            // Test user specific logging
            if user_id == "test_user" {
                let perms_for_entity_being_checked = user.permissions.get(entity_id);
                println!("[RBAC_EXPLICIT_CHECK_DETAIL_PRINTLN] For user_id: '{}', entity_id: '{}', checking permission: {:?}. User's explicit permissions for this entity: {:?}. Required perm present: {}", user_id, entity_id, permission, perms_for_entity_being_checked, perms_for_entity_being_checked.is_some_and(|s| s.contains(&permission)));
            }
            
            debug!(target: "citadel", "[CHECK_ENTITY_PERM_PRE_CHECK] User: {}, Entity: {}, PermToChk: {:?}, UserPermsForEntity: {:?}", user_id, entity_id, permission, user.permissions.get(entity_id));
            
            // Check if user has the specific permission for this entity
            if user.has_permission(entity_id, permission) {
                println!("[RBAC_EXPLICIT_GRANT_PRINTLN] User '{}' has explicit permission {:?} for entity '{}'. Details: {:?}", user_id, permission, entity_id, user.permissions.get(entity_id));
                return Ok(true);
            }

            // Store the user role for later use
            user.role.clone()
        } else {
            error!(target: "citadel", "User with id {} not found", user_id);
            return Err(NetworkError::msg(format!(
                "User with id {} not found",
                user_id
            )));
        };

        // If the entity is the workspace root, check workspace-level permissions
        if entity_id == WORKSPACE_ROOT_ID {
            debug!(target: "citadel", "[RBAC_WORKSPACE_ROOT_CHECK] User: {}, Role: {:?}, Permission: {:?}", user_id, user_role, permission);
            
            // Use retrieve_role_permissions to get permissions for this role and domain type
            let role_permissions = super::retrieve_role_permissions(&user_role, &DomainType::Workspace);
            
            // Check if the requested permission is in the role's permissions
            let has_permission = role_permissions.contains(&permission);
            debug!(target: "citadel", "[RBAC_WORKSPACE_ROOT_RESULT] User: {}, Permission: {:?}, Has permission: {}", user_id, permission, has_permission);
            
            return Ok(has_permission);
        }

        // Check if the entity is a domain (office or room)
        if let Some(domain) = tx.get_domain(entity_id) {
            // Determine domain type based on the domain enum variant
            let domain_type_str = if domain.as_workspace().is_some() {
                "workspace"
            } else if domain.as_office().is_some() {
                "office"
            } else if domain.as_room().is_some() {
                "room"
            } else {
                "unknown"
            };
            
            debug!(target: "citadel", "[RBAC_DOMAIN_CHECK] User: {}, Domain: {}, Type: {}, Permission: {:?}", 
                  user_id, entity_id, domain_type_str, permission);
            
            // Get domain type based on domain enum variant
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

            // Check if user is a member of the domain
            let is_member = domain.members().iter().any(|member_id| member_id == user_id);
            // Since we don't have role information in members, assume Member role if they're a member
            let user_role_in_domain = if is_member {
                Some(UserRole::Member)
            } else {
                None
            };
            
            if let Some(role) = user_role_in_domain {
                debug!(target: "citadel", "[RBAC_DOMAIN_MEMBERSHIP] User: {}, Domain: {}, Role in domain: {:?}", user_id, entity_id, role);
                
                // Get the permissions for this role and domain type
                let role_permissions = super::retrieve_role_permissions(&role, &domain_type);
                
                // Check if the role grants the permission
                let has_permission = role_permissions.contains(&permission);
                debug!(target: "citadel", "[RBAC_DOMAIN_PERMISSION] User: {}, Domain: {}, Permission: {:?}, Has permission: {}", user_id, entity_id, permission, has_permission);
                
                if has_permission {
                    return Ok(true);
                }
            }

            // If no direct permission, check the parent domain recursively
            let parent_id = domain.parent_id();
            if parent_id != "" {
                debug!(target: "citadel", "[RBAC_CHECKING_PARENT] User: {}, Current domain: {}, Parent domain: {}", user_id, entity_id, parent_id);
                
                // Recursive check on parent domain
                return self.check_entity_permission_with_tx(tx, user_id, parent_id, permission);
            }
        }

        // If we reach here, the user does not have permission
        debug!(target: "citadel", "[RBAC_CHECK_RESULT] User: {}, Entity: {}, Permission: {:?}, Result: false", user_id, entity_id, permission);
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
        debug!(target: "citadel", "[RBAC_CHECK_INIT] Checking permission for user: {}, entity: {}, permission: {:?}", user_id, entity_id, permission);
        
        // Create a read transaction and perform the check
        self.with_read_transaction(|tx| {
            self.check_entity_permission_with_tx(tx, user_id, entity_id, permission)
        })
    }
}
