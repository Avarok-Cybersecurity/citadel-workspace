use crate::kernel::transaction::read::ReadTransaction;
use crate::kernel::transaction::write::WriteTransaction;
use crate::kernel::transaction::{Transaction, TransactionManager};
use citadel_logging::{debug, error, info};
use citadel_sdk::prelude::NetworkError;
use citadel_workspace_types::structs::{Domain, Permission, User, UserRole};
use citadel_workspace_types::UpdateOperation;
use std::collections::HashSet;

// Helper enum to distinguish domain types for permission mapping
#[derive(Debug)]
pub enum DomainType {
    Workspace,
    Office,
    Room,
}

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
        debug!(target: "citadel", "[RBAC_ENTRY_LOG] ENTERING check_entity_permission_with_tx. User: {}, Entity: {}, Permission: {:?}", user_id, entity_id, permission);

        // Log user retrieval attempt for ANY user during the critical path
        // We expect this to be "test_user" for the failing call.
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

        // +++ ADDED LOGGING +++
        if user_id == "admin" {
            // Compare with the string literal used in tests
            info!(target: "citadel", "[RBAC_CHECK_TEST_USER] Retrieved user for 'test_user': {:?}", user_opt_for_log.is_some());
            if let Some(user_details) = admin_check_user.as_ref() {
                info!(target: "citadel", "[RBAC_CHECK_TEST_USER] 'test_user' details: Role: {:?}, Permissions map: {:?}", user_details.role, user_details.permissions);
            }
        }
        // +++ END LOGGING +++

        let is_admin_by_role = admin_check_user
            .map(|u| u.role == UserRole::Admin)
            .unwrap_or(false);
        debug!(target: "citadel", "[ADMIN_CHECK_DETAIL] Value of is_admin_by_role (just before if): {}", is_admin_by_role);

        if is_admin_by_role {
            // Admin has permission, log already exists prior to this block if needed for admin.
            return Ok(true);
        }
        debug!(target: "citadel", "[ADMIN_CHECK_DETAIL] User {} is NOT admin by role OR the admin block was not entered. Proceeding with other checks.", user_id);

        // Get the user and check their permissions
        let user_role = if let Some(user) = tx.get_user(user_id) {
            // Specific detailed log for WORKSPACE_ROOT_ID checks
            if entity_id == crate::WORKSPACE_ROOT_ID {
                println!("[DEBUG_WORKSPACE_ROOT_CHECK_PRINTLN] User: '{}', Entity_ID: '{}' (is WORKSPACE_ROOT_ID), Checking Perm: {:?}. User's FULL permissions map in this Read TX: {:?}", user_id, entity_id, permission, user.permissions);
                let specific_perms = user.permissions.get(entity_id);
                println!("[DEBUG_WORKSPACE_ROOT_CHECK_DETAIL_PRINTLN] Lookup for WORKSPACE_ROOT_ID ('{}') in user's map: {:?}. Contains {:?}: {}", entity_id, specific_perms, permission, specific_perms.is_some_and(|s| s.contains(&permission)));
            }

            // The existing general log for test_user can remain or be removed if too noisy
            if user_id == "test_user" {
                // Log specifically for the user in the failing test
                let perms_for_entity_being_checked = user.permissions.get(entity_id);
                println!("[RBAC_EXPLICIT_CHECK_DETAIL_PRINTLN] For user_id: '{}', entity_id: '{}', checking permission: {:?}. User's explicit permissions for this entity: {:?}. Required perm present: {}", user_id, entity_id, permission, perms_for_entity_being_checked, perms_for_entity_being_checked.is_some_and(|s| s.contains(&permission)));
            }
            // +++ END DETAILED LOGGING +++
            debug!(target: "citadel", "[CHECK_ENTITY_PERM_PRE_CHECK] User: {}, Entity: {}, PermToChk: {:?}, UserPermsForEntity: {:?}", user_id, entity_id, permission, user.permissions.get(entity_id));
            // Check if user has the specific permission for this entity
            if user.has_permission(entity_id, permission) {
                println!("[RBAC_EXPLICIT_GRANT_PRINTLN] User '{}' has explicit permission {:?} for entity '{}'. Details: {:?}", user_id, permission, entity_id, user.permissions.get(entity_id));
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

                // For workspaces, being a member is sufficient for most checks that reach this point
                if workspace.members.contains(&user_id.to_string()) {
                    debug!(target: "citadel", "User {} is a member of workspace {}, permission granted", user_id, entity_id);
                    return Ok(true);
                }

                Ok(false)
            }
            Some(Domain::Office { office }) => {
                // Denylist check
                // if office.denylist.contains(&user_id.to_string()) {
                //     debug!(target: "citadel", "User {} is on the denylist for office {}, access denied", user_id, entity_id);
                //     return Ok(false);
                // }

                // Owner check
                if office.owner_id == user_id {
                    return Ok(true);
                }

                // If user is an explicit member, check permissions based on their role.
                if office.members.contains(&user_id.to_string()) {
                    let permissions_for_role = Permission::for_role(&user_role);
                    if permissions_for_role.contains(&permission) {
                        debug!(target: "citadel", "User {} granted {:?} on office {} via explicit membership and role {:?}", user_id, permission, entity_id, user_role);
                        return Ok(true);
                    }
                    // Explicit member but role does not grant permission, so they don't get it.
                    // Do not proceed to check for inheritance, as explicit membership should be final.
                    return Ok(false);
                }

                // Workspace inheritance check
                let granted_by_workspace_inheritance = if let Some(Domain::Workspace {
                    workspace,
                }) = tx.get_domain(&office.workspace_id)
                {
                    // Check if user has the required permission directly on the parent workspace
                    if tx
                        .get_user(user_id)
                        .is_some_and(|u| u.has_permission(&workspace.id, permission))
                    {
                        // TODO: Be more specific about which permissions can be inherited here, e.g. ViewContent, AddUserToOffice etc.
                        // For now, assume any direct perm on workspace can grant it to office if not explicitly denied.
                        debug!(target: "citadel", "User {} granted {:?} on office {} via direct permission on parent workspace {}", user_id, permission, entity_id, &workspace.id);
                        true
                    } else if workspace.members.contains(&user_id.to_string())
                        && permission == Permission::ViewContent
                    {
                        debug!(target: "citadel", "User {} granted ViewContent on office {} via workspace {} membership (fallback)", user_id, entity_id, &office.workspace_id);
                        true
                    } else {
                        // Workspace exists, but no permission granted through it by these checks.
                        false
                    }
                } else {
                    // No parent workspace found, so no permission can be inherited from it.
                    false
                };

                if granted_by_workspace_inheritance {
                    return Ok(true);
                }

                // Default for Office if no permissions found by any check above (owner, explicit member, or successful workspace inheritance).
                debug!(target: "citadel", "User {} - Office {}: No explicit, owner, or workspace inheritance grants {:?}. Denying.", user_id, entity_id, permission);
                Ok(false)
            } // Closes: Some(Domain::Office { office })

            Some(Domain::Room { room }) => {
                // Denylist check for room (if applicable)
                // if room.denylist.contains(&user_id.to_string()) {
                //     debug!(target: "citadel", "User {} is on the denylist for room {}, access denied", user_id, entity_id);
                //     return Ok(false);
                // }

                // Owner check for room
                if room.owner_id == user_id {
                    debug!(target: "citadel", "User {} is owner of room {}, permission granted", user_id, entity_id);
                    return Ok(true);
                }

                // If user is an explicit member of the room, check permissions based on their role.
                if room.members.contains(&user_id.to_string()) {
                    let permissions_for_role = Permission::for_role(&user_role); // user_role was fetched earlier
                    if permissions_for_role.contains(&permission) {
                        debug!(target: "citadel", "User {} granted {:?} on room {} via explicit membership and role {:?}", user_id, permission, entity_id, user_role);
                        return Ok(true);
                    }
                    // Explicit member but role does not grant permission for this room.
                    // Do not proceed to check for inheritance for this room, as explicit membership here is final for the room itself.
                    return Ok(false);
                }

                // Inheritance checks if not explicit room member or owner
                if let Some(Domain::Office { office }) = tx.get_domain(&room.office_id) {
                    // 3a. Check direct permission on parent Office
                    if tx
                        .get_user(user_id)
                        .is_some_and(|u| u.has_permission(&office.id, permission))
                        && [
                            Permission::ViewContent,
                            Permission::ReadMessages,
                            Permission::SendMessages,
                            Permission::CreateRoom,
                        ]
                        .contains(&permission)
                    {
                        debug!(target: "citadel", "User {} granted {:?} on room {} via direct permission on parent office {}", user_id, permission, entity_id, &office.id);
                        return Ok(true);
                    }
                    // 3b. Fallback: Original check for office membership granting ViewContent (might be redundant)
                    if office.members.contains(&user_id.to_string())
                        && permission == Permission::ViewContent
                    {
                        debug!(target: "citadel", "User {} granted ViewContent on room {} via office {} membership (fallback)", user_id, entity_id, &office.id);
                        return Ok(true);
                    }

                    // 4. If not granted via office, check grandparent Workspace
                    if let Some(Domain::Workspace { workspace }) =
                        tx.get_domain(&office.workspace_id)
                    {
                        // 4a. Check direct permission on grandparent Workspace
                        if tx
                            .get_user(user_id)
                            .is_some_and(|u| u.has_permission(&workspace.id, permission))
                            && [
                                Permission::ViewContent,
                                Permission::ReadMessages,
                                Permission::SendMessages,
                            ]
                            .contains(&permission)
                        {
                            debug!(target: "citadel", "User {} granted {:?} on room {} via direct permission on grandparent workspace {}", user_id, permission, entity_id, &workspace.id);
                            return Ok(true);
                        }
                        // 4b. Fallback: Original check for workspace membership granting ViewContent (might be redundant)
                        if workspace.members.contains(&user_id.to_string())
                            && permission == Permission::ViewContent
                        {
                            debug!(target: "citadel", "User {} granted ViewContent on room {} via workspace {} membership (fallback to grandparent)", user_id, entity_id, &workspace.id);
                            return Ok(true);
                        }
                    }
                }
                Ok(false) // Default for room if no permissions found through any check
            } // Closes: Some(Domain::Room { room })

            None => {
                // THIS IS WHERE "Workspace workspace-root not found" WOULD ORIGINATE
                // if entity_id was WORKSPACE_ROOT_ID and it wasn't found.
                // Let's make this log more specific if entity_id is WORKSPACE_ROOT_ID
                if entity_id == crate::WORKSPACE_ROOT_ID {
                    // <<< NEW LINES START HERE
                    println!("[CRITICAL_WORKSPACE_ROOT_NOT_FOUND_IN_GET_DOMAIN_PRINTLN] WORKSPACE_ROOT_ID ('{}') not found by tx.get_domain! User: '{}', Perm: '{:?}'", entity_id, user_id, permission);
                } // <<< NEW LINES END HERE
                error!(target: "citadel", "[RBAC_ENTITY_NOT_FOUND_PRINTLN] Entity domain '{}' not found in check_entity_permission_with_tx. User: '{}', Perm: '{:?}'", entity_id, user_id, permission);
                Err(NetworkError::msg(format!(
                    "Entity domain '{}' not found",
                    entity_id
                )))
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

    /// Create a new read transaction
    pub fn read_transaction(&self) -> ReadTransaction {
        let domains_guard = self.domains.read();

        // Diagnostic log specifically for "ws1_id", which is used in the failing test
        if let Some(domain_ws1) = domains_guard.get("ws1_id") {
            debug!(target: "citadel", "[TM_READ_TX_CREATE] Post-lock, pre-RTX (ws1_id): Domain members: {:?}", domain_ws1.members());
        } else {
            debug!(target: "citadel", "[TM_READ_TX_CREATE] Post-lock, pre-RTX (ws1_id): Domain NOT FOUND");
        }

        ReadTransaction::new(
            domains_guard, // Use the guard we just acquired and logged from
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
            self.db.clone(),
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

/// Returns the set of permissions granted by a specific role for a given domain type.
pub fn retrieve_role_permissions(role: &UserRole, domain_type: &DomainType) -> Vec<Permission> {
    let mut permissions = Vec::new();

    match domain_type {
        DomainType::Workspace => match role {
            UserRole::Owner => {
                permissions.extend(vec![
                    Permission::EditWorkspaceConfig,
                    Permission::AddUsers,         // For adding members
                    Permission::RemoveUsers, // For removing members (member management also involves role checks elsewhere)
                    Permission::CreateOffice, // Can create offices in the workspace
                    Permission::DeleteOffice, // Can delete offices in the workspace
                    Permission::EditOfficeConfig, // Can edit config of offices they manage/own
                    Permission::CreateRoom,  // Can create rooms in offices they manage/own
                    Permission::DeleteRoom,  // Can delete rooms
                    Permission::EditRoomConfig, // Can edit room config
                    Permission::ViewContent, // Can view content within the workspace
                    Permission::EditContent, // For managing/editing content within the workspace
                ]);
            }
            UserRole::Admin => {
                // Admins get all permissions related to managing the workspace itself,
                // but not necessarily all data access permissions within all sub-domains unless also Owner/Admin there.
                permissions.extend(vec![
                    Permission::CreateOffice,
                    Permission::DeleteOffice,
                    Permission::UpdateWorkspace,
                    Permission::AddUsers,
                    Permission::RemoveUsers,
                    Permission::EditWorkspaceConfig,
                    Permission::BanUser, // Admins can ban users from the workspace
                ]);
            }
            UserRole::Member => {
                // Regular members can view content and potentially create offices if allowed by config (handled elsewhere)
                permissions.extend(vec![
                    Permission::ViewContent,  // General permission to see the workspace exists
                    Permission::CreateOffice, // Subject to workspace settings
                    Permission::SendMessages, // If there's a workspace-level chat
                    Permission::ReadMessages, // If there's a workspace-level chat
                ]);
            }
            _ => {} // Guests, Banned, Custom - typically no direct workspace creation/management perms
        },
        DomainType::Office => match role {
            UserRole::Owner => {
                permissions.extend(vec![
                    Permission::UpdateOffice,        // Owner can update office settings
                    Permission::DeleteOffice,        // Owner can delete the office
                    Permission::CreateRoom,          // Owner can create rooms in their office
                    Permission::AddUsers,            // Invite users to the office
                    Permission::RemoveUsers,         // Remove users from the office
                    Permission::ManageOfficeMembers, // <<< ADDED THIS LINE
                    Permission::EditContent, // Was ModifyContent, broader edit rights for owner
                    // For DeleteContent, an Office Owner can delete the office itself
                    // Permission::DeleteOffice, // Already added
                    Permission::EditOfficeConfig,
                    Permission::SendMessages, // Office-wide announcements, etc.
                    Permission::ReadMessages,
                    Permission::UploadFiles, // To office-level storage if any
                    Permission::DownloadFiles,
                ]);
            }
            UserRole::Admin => {
                permissions.extend(vec![Permission::All]);
            }
            UserRole::Member => {
                permissions.extend(vec![
                    Permission::ViewContent,
                    Permission::EditContent, // Was ModifyContent
                    Permission::CreateRoom,
                    Permission::SendMessages,
                    Permission::ReadMessages,
                    Permission::UploadFiles,
                    Permission::DownloadFiles,
                ]);
            }
            _ => {} // Guests, Banned, Custom
        },
        DomainType::Room => match role {
            UserRole::Owner => {
                permissions.extend(vec![
                    Permission::UpdateRoom,  // Owner can update room settings
                    Permission::DeleteRoom,  // Owner can delete the room
                    Permission::AddUsers,    // Invite users to the room (was InviteUserToRoom)
                    Permission::RemoveUsers, // Remove users from the room
                    Permission::EditContent, // Was ModifyContent
                    // For DeleteContent, a Room Owner can delete the room itself
                    // Permission::DeleteRoom, // Already added
                    Permission::EditRoomConfig,
                    Permission::SendMessages,
                    Permission::ReadMessages,
                    Permission::UploadFiles,
                    Permission::DownloadFiles,
                ]);
            }
            UserRole::Admin => {
                permissions.extend(vec![Permission::All]);
            }
            UserRole::Member => {
                permissions.extend(vec![
                    Permission::ViewContent,
                    Permission::EditContent, // Was ModifyContent
                    Permission::SendMessages,
                    Permission::ReadMessages,
                    Permission::UploadFiles,
                    Permission::DownloadFiles,
                ]);
            }
            _ => {} // Guests, Banned, Custom
        },
    }

    // Remove duplicates that might have been added if logic overlaps (e.g. DeleteRoom for Office Owner)
    let mut unique_permissions = HashSet::new();
    permissions.retain(|p| unique_permissions.insert(*p));

    permissions
}
