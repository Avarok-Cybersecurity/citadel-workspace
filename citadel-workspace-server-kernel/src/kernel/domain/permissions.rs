use crate::kernel::WorkspaceServerKernel;
use citadel_logging::debug;
use citadel_sdk::prelude::{NetworkError, Ratchet};
use citadel_workspace_types::structs::{Domain, Office, Permission, Room, UserRole, Workspace};
use citadel_workspace_types::UpdateOperation;

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
    /// 4. For hierarchical domains, checks parent domains for permissions
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
                Some(Domain::Workspace { workspace }) => {
                    // Workspace owners have all permissions for their workspace
                    if workspace.owner_id == user_id {
                        debug!(target: "citadel", "User {} is owner of workspace {}, permission granted", user_id, entity_id);
                        return Ok(true);
                    }

                    // Workspace members may have some permissions based on role
                    if workspace.members.contains(&user_id.to_string()) {
                        match user_role {
                            UserRole::Admin => Ok(true), // Admins have all permissions
                            UserRole::Owner => Ok(true), // Owners have all permissions for entities they belong to
                            UserRole::Member => {
                                match permission {
                                    Permission::ViewContent => Ok(true), // Members can view content
                                    _ => Ok(false),
                                }
                            }
                            _ => Ok(false),
                        }
                    } else {
                        Ok(false)
                    }
                },
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
                                match permission {
                                    Permission::ViewContent => Ok(true), // Members can view content
                                    _ => Ok(false),
                                }
                            }
                            _ => Ok(false),
                        }
                    } else {
                        // Check if the user has permissions via a parent workspace
                        // Try to find which workspace contains this office
                        for workspace in tx.get_all_workspaces().values() {
                            if workspace.offices.contains(&office.id) && (workspace.owner_id == user_id || workspace.members.contains(&user_id.to_string())) {
                                // User is a member of the parent workspace - check role permissions
                                match user_role {
                                    UserRole::Admin | UserRole::Owner => return Ok(true),
                                    UserRole::Member => {
                                        return match permission {
                                            Permission::ViewContent => Ok(true),
                                            _ => Ok(false),
                                        };
                                    }
                                    _ => return Ok(false),
                                }
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
                        match user_role {
                            UserRole::Admin => Ok(true), // Admins have all permissions
                            UserRole::Owner => Ok(true), // Owners have all permissions for entities they belong to
                            UserRole::Member => {
                                match permission {
                                    Permission::ViewContent => Ok(true), // Members can view content
                                    _ => Ok(false),
                                }
                            }
                            _ => Ok(false),
                        }
                    } else {
                        // Check if the user has permissions via the parent office
                        // First get the parent office
                        if let Some(Domain::Office { office }) = tx.get_domain(&room.office_id) {
                            if office.owner_id == user_id || office.members.contains(&user_id.to_string()) {
                                // User is a member of the parent office - check role permissions
                                match user_role {
                                    UserRole::Admin | UserRole::Owner => return Ok(true),
                                    UserRole::Member => {
                                        return match permission {
                                            Permission::ViewContent => Ok(true),
                                            _ => Ok(false),
                                        };
                                    }
                                    _ => return Ok(false),
                                }
                            }

                            // Check if there's a parent workspace with access
                            for workspace in tx.get_all_workspaces().values() {
                                if workspace.offices.contains(&office.id) && (workspace.owner_id == user_id || workspace.members.contains(&user_id.to_string())) {
                                    // User is a member of the parent workspace - check role permissions
                                    match user_role {
                                        UserRole::Admin | UserRole::Owner => return Ok(true),
                                        UserRole::Member => {
                                            return match permission {
                                                Permission::ViewContent => Ok(true),
                                                _ => Ok(false),
                                            };
                                        }
                                        _ => return Ok(false),
                                    }
                                }
                            }
                        }
                        Ok(false)
                    }
                }
                None => Err(NetworkError::msg("Domain not found")),
            }
        })
    }

    /// Check if a user is an admin
    ///
    /// Centralizes admin checking logic in one place
    pub fn is_admin(&self, user_id: &str) -> bool {
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

    /// Check if user is an admin of a domain
    pub fn check_domain_admin(&self, user_id: &str, domain_id: &str) -> Result<bool, NetworkError> {
        // System administrators are admins of all domains
        if self.is_admin(user_id) {
            return Ok(true);
        }

        // Get the domain and check if user is an admin
        self.with_read_transaction(|tx| {
            if let Some(domain) = tx.get_domain(domain_id) {
                match domain {
                    Domain::Office { office } => Ok(self.is_office_admin(office, user_id)),
                    Domain::Room { room } => Ok(self.is_room_admin(room, user_id)),
                    Domain::Workspace { workspace } => {
                        Ok(self.is_workspace_admin(workspace, user_id))
                    }
                }
            } else {
                Err(NetworkError::msg(format!("Domain {} not found", domain_id)))
            }
        })
    }

    /// Check if a user is an admin of a workspace
    pub fn is_workspace_admin(&self, workspace: &Workspace, user_id: &str) -> bool {
        // System administrators are always admins
        if self.is_admin(user_id) {
            return true;
        }

        // Workspace owner is admin
        if workspace.owner_id == user_id {
            return true;
        }

        // Check if user has workspace admin permissions
        let has_admin_permission = self
            .with_read_transaction(|tx| {
                if let Some(user) = tx.get_user(user_id) {
                    Ok(user.has_permission(&workspace.id, Permission::All))
                } else {
                    Ok(false)
                }
            })
            .unwrap_or(false);

        has_admin_permission
    }

    /// Check if a user is the owner of a workspace
    pub fn is_workspace_owner(&self, workspace: &Workspace, user_id: &str) -> bool {
        workspace.owner_id == user_id
    }

    /// Check if a specific user is an admin of the indicated domain
    ///
    /// This checks if:
    /// 1. The user is a system admin
    /// 2. The user is the owner of the domain
    pub fn is_domain_admin(&self, user_id: &str, domain_id: &str) -> Result<bool, NetworkError> {
        self.with_read_transaction(|tx| {
            // System administrators are admins of all domains
            if tx.is_admin(user_id) {
                return Ok(true);
            }

            let domain = tx.get_domain(domain_id);
            match domain {
                Some(Domain::Office { office }) => Ok(office.owner_id == user_id),
                Some(Domain::Room { room }) => Ok(room.owner_id == user_id),
                Some(Domain::Workspace { workspace }) => Ok(workspace.owner_id == user_id),
                None => Err(NetworkError::msg(format!("Domain {} not found", domain_id))),
            }
        })
    }

    /// Check if a user is an owner of any domain
    pub fn is_owner(&self, user_id: &str, domain_id: &str) -> Result<bool, NetworkError> {
        self.with_read_transaction(|tx| {
            let domain = tx.get_domain(domain_id);
            match domain {
                Some(Domain::Office { office }) => Ok(office.owner_id == user_id),
                Some(Domain::Room { room }) => Ok(room.owner_id == user_id),
                Some(Domain::Workspace { workspace }) => Ok(workspace.owner_id == user_id),
                None => Err(NetworkError::msg(format!("Domain {} not found", domain_id))),
            }
        })
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
        if !self.check_domain_admin(user_id, domain_id)? {
            return Err(NetworkError::msg(
                "Permission denied: You must be an admin or the domain owner to update permissions",
            ));
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
        if !self.check_domain_admin(admin_id, domain_id)? {
            return Err(NetworkError::msg(
                "Permission denied: Only admins or domain owners can set permissions",
            ));
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

    /// Check if a user is an admin of an office
    pub fn is_office_admin(&self, office: &Office, user_id: &str) -> bool {
        // System administrators are always admins
        if self.is_admin(user_id) {
            return true;
        }

        // Office owner is admin
        if office.owner_id == user_id {
            return true;
        }

        // Check if user has office admin permissions
        let has_admin_permission = self
            .with_read_transaction(|tx| {
                if let Some(user) = tx.get_user(user_id) {
                    Ok(user.has_permission(&office.id, Permission::All))
                } else {
                    Ok(false)
                }
            })
            .unwrap_or(false);

        has_admin_permission
    }

    /// Check if a user is an admin of a room
    pub fn is_room_admin(&self, room: &Room, user_id: &str) -> bool {
        // System administrators are always admins
        if self.is_admin(user_id) {
            return true;
        }

        // Room owner is admin
        if room.owner_id == user_id {
            return true;
        }

        // Check if user has room admin permissions
        let has_room_permission = self
            .with_read_transaction(|tx| {
                if let Some(user) = tx.get_user(user_id) {
                    Ok(user.has_permission(&room.id, Permission::All))
                } else {
                    Ok(false)
                }
            })
            .unwrap_or(false);

        // If they have direct room admin permissions
        if has_room_permission {
            return true;
        }

        // Check if they are an admin of the parent office
        let has_office_admin = self
            .with_read_transaction(|tx| {
                if let Some(domain) = tx.get_domain(&room.office_id) {
                    match domain {
                        Domain::Office { office } => Ok(self.is_office_admin(office, user_id)),
                        _ => Ok(false),
                    }
                } else {
                    Ok(false)
                }
            })
            .unwrap_or(false);

        has_office_admin
    }
}
