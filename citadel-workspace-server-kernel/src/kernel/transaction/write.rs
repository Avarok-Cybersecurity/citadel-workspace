use crate::kernel::transaction::{
    retrieve_role_permissions, DomainChange, DomainType, Transaction, UserChange, WorkspaceChange,
    WorkspaceOperations,
};
use bincode; // For serialization
use bcrypt;
use citadel_logging::debug;
use citadel_sdk::prelude::NetworkError;
use citadel_workspace_types::structs::{Domain, Permission, User, UserRole, Workspace};
use parking_lot::RwLockWriteGuard;
use rocksdb::DB; // Already used, just for clarity
use std::collections::HashMap;
use std::sync::Arc; // Already used

/// A writable transaction that can modify domains and users
pub struct WriteTransaction<'a> {
    pub(crate) domains: RwLockWriteGuard<'a, HashMap<String, Domain>>,
    pub(crate) users: RwLockWriteGuard<'a, HashMap<String, User>>,
    pub(crate) workspaces: RwLockWriteGuard<'a, HashMap<String, Workspace>>,
    pub(crate) workspace_password: RwLockWriteGuard<'a, HashMap<String, String>>,
    pub(crate) domain_changes: Vec<DomainChange>,
    pub(crate) user_changes: Vec<UserChange>,
    pub(crate) workspace_changes: Vec<WorkspaceChange>,
    pub(crate) db: Arc<DB>,
}

impl<'a> WriteTransaction<'a> {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        domains: RwLockWriteGuard<'a, HashMap<String, Domain>>,
        users: RwLockWriteGuard<'a, HashMap<String, User>>,
        workspaces: RwLockWriteGuard<'a, HashMap<String, Workspace>>,
        workspace_password: RwLockWriteGuard<'a, HashMap<String, String>>,
        db: Arc<DB>,
    ) -> Self {
        Self {
            domains,
            users,
            workspaces,
            workspace_password,
            domain_changes: Vec::new(),
            user_changes: Vec::new(),
            workspace_changes: Vec::new(),
            db,
        }
    }

    /// Rollback changes made in the transaction
    pub fn rollback(&mut self) -> Result<(), NetworkError> {
        // Revert domain changes
        for change in self.domain_changes.drain(..).rev() {
            match change {
                DomainChange::Insert(id) => {
                    self.domains.remove(&id);
                }
                DomainChange::Update(id, old_domain) => {
                    self.domains.insert(id, old_domain);
                }
                DomainChange::Remove(id, old_domain) => {
                    self.domains.insert(id, old_domain);
                }
            }
        }

        // Revert user changes
        for change in self.user_changes.drain(..).rev() {
            match change {
                UserChange::Insert(id) => {
                    self.users.remove(&id);
                }
                UserChange::Update(id, old_user) => {
                    self.users.insert(id, old_user);
                }
                UserChange::Remove(id, old_user) => {
                    self.users.insert(id, old_user);
                }
            }
        }

        // Revert workspace changes
        for change in self.workspace_changes.drain(..).rev() {
            match change {
                WorkspaceChange::Insert(id) => {
                    self.workspaces.remove(&id);
                }
                WorkspaceChange::Update(id, old_workspace) => {
                    self.workspaces.insert(id, old_workspace);
                }
                WorkspaceChange::Remove(id, old_workspace) => {
                    self.workspaces.insert(id, old_workspace);
                }
            }
        }

        Ok(())
    }
}

impl Transaction for WriteTransaction<'_> {
    fn workspace_password(&self, workspace_id: &str) -> Option<String> {
        self.workspace_password.get(workspace_id).cloned()
    }

    fn set_workspace_password(
        &mut self,
        workspace_id: &str,
        password: &str,
    ) -> Result<(), NetworkError> {
        if password.is_empty() {
            // Passwords cannot be empty. If an attempt is made to set an empty password,
            // it could be treated as an attempt to remove password protection, or an error.
            // For now, let's return an error, as workspaces should be password protected.
            // Alternatively, one might remove the entry: self.workspace_password.remove(workspace_id);
            return Err(NetworkError::msg("Workspace password cannot be empty"));
        }
        // Hash the password before storing
        let hashed_password = bcrypt::hash(password, bcrypt::DEFAULT_COST)
            .map_err(|e| NetworkError::msg(format!("Failed to hash workspace password: {}", e)))?;
        self.workspace_password
            .insert(workspace_id.to_string(), hashed_password);
        Ok(())
    }

    fn get_domain(&self, domain_id: &str) -> Option<&Domain> {
        self.domains.get(domain_id)
    }

    fn get_domain_mut(&mut self, domain_id: &str) -> Option<&mut Domain> {
        println!(
            "[WTX_GET_DOMAIN_MUT] Called for domain_id: '{}'. self.domains.contains_key: {}",
            domain_id,
            self.domains.contains_key(domain_id)
        );
        self.domains.get_mut(domain_id)
    }

    fn get_all_domains(&self) -> Result<Vec<(String, Domain)>, NetworkError> {
        Ok(self
            .domains
            .iter()
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect())
    }

    fn get_workspace(&self, workspace_id: &str) -> Option<&Workspace> {
        self.workspaces.get(workspace_id)
    }

    fn get_workspace_mut(&mut self, workspace_id: &str) -> Option<&mut Workspace> {
        println!("[WTX_GET_WORKSPACE_MUT] Called for workspace_id: '{}'. self.workspaces.contains_key: {}", workspace_id, self.workspaces.contains_key(workspace_id));
        self.workspaces.get_mut(workspace_id)
    }

    fn get_all_workspaces(&self) -> &HashMap<String, Workspace> {
        &self.workspaces
    }

    fn get_user(&self, user_id: &str) -> Option<&User> {
        self.users.get(user_id)
    }

    fn get_user_mut(&mut self, user_id: &str) -> Option<&mut User> {
        self.users.get_mut(user_id)
    }

    fn get_all_users(&self) -> &HashMap<String, User> {
        &self.users
    }

    fn is_member_of_domain(&self, user_id: &str, domain_id: &str) -> Result<bool, NetworkError> {
        let domain = self
            .get_domain(domain_id)
            .ok_or_else(|| NetworkError::msg(format!("Domain not found: {}", domain_id)))?;
        match domain {
            Domain::Workspace { workspace } => Ok(workspace.members.contains(&user_id.to_string())),
            Domain::Office { office } => Ok(office.members.contains(&user_id.to_string())),
            Domain::Room { room } => Ok(room.members.contains(&user_id.to_string())),
        }
    }

    fn insert_domain(&mut self, domain_id: String, domain: Domain) -> Result<(), NetworkError> {
        self.domain_changes
            .push(DomainChange::Insert(domain_id.clone()));
        self.domains.insert(domain_id, domain);
        Ok(())
    }

    fn insert_workspace(
        &mut self,
        workspace_id: String,
        workspace: Workspace,
    ) -> Result<(), NetworkError> {
        self.workspace_changes
            .push(WorkspaceChange::Insert(workspace_id.clone()));
        self.workspaces.insert(workspace_id, workspace);
        Ok(())
    }

    fn insert_user(&mut self, user_id: String, user: User) -> Result<(), NetworkError> {
        self.user_changes.push(UserChange::Insert(user_id.clone()));
        self.users.insert(user_id, user);
        Ok(())
    }

    fn update_domain(&mut self, domain_id: &str, new_domain: Domain) -> Result<(), NetworkError> {
        if let Some(old_domain) = self.domains.get(domain_id).cloned() {
            self.domain_changes
                .push(DomainChange::Update(domain_id.to_string(), old_domain));
            debug!("WriteTransaction::update_domain - domain_id: {}, new_members: {:?}", domain_id, new_domain.members());
            self.domains.insert(domain_id.to_string(), new_domain.clone());

            // Also update the parallel workspaces map if this is a workspace
            if let Domain::Workspace { workspace } = new_domain {
                self.workspaces.insert(domain_id.to_string(), workspace);
            }

            Ok(())
        } else {
            Err(NetworkError::msg("Domain not found"))
        }
    }

    fn update_workspace(
        &mut self,
        workspace_id: &str,
        new_workspace: Workspace,
    ) -> Result<(), NetworkError> {
        if let Some(old_workspace) = self.workspaces.get(workspace_id).cloned() {
            self.workspace_changes.push(WorkspaceChange::Update(
                workspace_id.to_string(),
                old_workspace,
            ));
            self.workspaces
                .insert(workspace_id.to_string(), new_workspace);
            Ok(())
        } else {
            Err(NetworkError::msg("Workspace not found"))
        }
    }

    fn update_user(&mut self, user_id: &str, new_user: User) -> Result<(), NetworkError> {
        if let Some(old_user) = self.users.get(user_id).cloned() {
            self.user_changes
                .push(UserChange::Update(user_id.to_string(), old_user));
            self.users.insert(user_id.to_string(), new_user);
            Ok(())
        } else {
            Err(NetworkError::msg("User not found"))
        }
    }

    fn remove_domain(&mut self, domain_id: &str) -> Result<Option<Domain>, NetworkError> {
        if let Some(domain) = self.domains.remove(domain_id) {
            self.domain_changes
                .push(DomainChange::Remove(domain_id.to_string(), domain.clone()));
            Ok(Some(domain))
        } else {
            Ok(None)
        }
    }

    fn remove_workspace(&mut self, workspace_id: &str) -> Result<Option<Workspace>, NetworkError> {
        if let Some(workspace) = self.workspaces.remove(workspace_id) {
            self.workspace_changes.push(WorkspaceChange::Remove(
                workspace_id.to_string(),
                workspace.clone(),
            ));
            Ok(Some(workspace))
        } else {
            Ok(None)
        }
    }

    fn remove_user(&mut self, user_id: &str) -> Result<Option<User>, NetworkError> {
        if let Some(user) = self.users.remove(user_id) {
            self.user_changes
                .push(UserChange::Remove(user_id.to_string(), user.clone()));
            Ok(Some(user))
        } else {
            Ok(None)
        }
    }

    fn add_user_to_domain(
        &mut self,
        user_id: &str,
        domain_id: &str,
        role: UserRole,
    ) -> Result<(), NetworkError> {
        // First, get mutable access to the user to update their permissions
        let user = self
            .users
            .get_mut(user_id)
            .ok_or_else(|| NetworkError::msg(format!("User not found: {}", user_id)))?;

        // Determine DomainType and get permissions for the role
        let domain_type_for_rbac;
        // Get the domain to determine its type and update its member list
        let domain_for_membership_update = self
            .domains
            .get_mut(domain_id)
            .ok_or_else(|| NetworkError::msg(format!("Domain not found: {}", domain_id)))?;

        match domain_for_membership_update {
            Domain::Workspace { workspace } => {
                domain_type_for_rbac = DomainType::Workspace;
                if !workspace.members.contains(&user_id.to_string()) {
                    workspace.members.push(user_id.to_string());
                }
            }
            Domain::Office { office } => {
                domain_type_for_rbac = DomainType::Office;
                if !office.members.contains(&user_id.to_string()) {
                    office.members.push(user_id.to_string());
                }
            }
            Domain::Room { room } => {
                domain_type_for_rbac = DomainType::Room;
                if !room.members.contains(&user_id.to_string()) {
                    room.members.push(user_id.to_string());
                }
            }
        };

        // Get the set of permissions for the given role and domain type
        let permissions_for_role = retrieve_role_permissions(&role, &domain_type_for_rbac);

        // Update the user's permissions map for this domain
        let domain_permissions_set = user.permissions.entry(domain_id.to_string()).or_default();
        for perm in &permissions_for_role {
            // Iterate over a slice here
            domain_permissions_set.insert(*perm); // Dereference perm
        }

        // +++ DETAILED LOGGING FOR PERMISSION ASSIGNMENT +++
        if user_id == "test_user_ws_add" {
            // Log specifically for the user in the failing test
            debug!(target: "citadel",
                "[TX_ADD_USER_TO_DOMAIN_DETAIL] For user_id: '{}', domain_id: '{}', role: {:?}. Assigned permissions: {:?}. Full user.permissions for this domain: {:?}",
                user_id,
                domain_id,
                role,
                &permissions_for_role, // Log the original Vec by reference
                user.permissions.get(domain_id) // The actual state of user.permissions for this domain_id after update
            );
            println!("[WRITE_TX_ADD_USER_TO_DOMAIN_PRINTLN] User '{}' updated for domain '{}' (Type: {:?}, Role: {:?}). Permissions for this domain: {:?}. Full map: {:?}",
                user_id, domain_id, domain_type_for_rbac, role, user.permissions.get(domain_id), user.permissions);
        }
        // +++ END DETAILED LOGGING +++

        debug!(target: "citadel", "[ADD_USER_TO_DOMAIN_PERMS] User: {}, Domain: {}, Role: {:?}, Final Permissions for Domain: {:?}", user_id, domain_id, role, user.permissions.get(domain_id));

        Ok(())
    }

    fn remove_user_from_domain(
        &mut self,
        user_id: &str,
        domain_id: &str,
    ) -> Result<(), NetworkError> {
        let domain = self
            .domains
            .get_mut(domain_id)
            .ok_or_else(|| NetworkError::msg(format!("Domain not found: {}", domain_id)))?;
        match domain {
            Domain::Workspace { workspace } => workspace.members.retain(|id| id != user_id),
            Domain::Office { office } => office.members.retain(|id| id != user_id),
            Domain::Room { room } => room.members.retain(|id| id != user_id),
        };
        Ok(())
    }

    fn commit(&self) -> Result<(), NetworkError> {
        println!("[COMMIT_WRITE_TX_PRINTLN] Attempting to commit WriteTransaction. Users map size: {}, Domains map size: {}", self.users.len(), self.domains.len());

        // Persist all users from the in-memory map to RocksDB
        for (user_id, user) in self.users.iter() {
            let user_key = format!("user::{}", user_id);
            let serialized_user = bincode::serialize(user).map_err(|e| {
                let err_msg = format!("Failed to serialize user {}: {}", user_id, e);
                eprintln!("[COMMIT_WRITE_TX_ERROR_PRINTLN] {}", err_msg);
                NetworkError::msg(&err_msg)
            })?;
            self.db
                .put(user_key.as_bytes(), serialized_user)
                .map_err(|e| {
                    let err_msg = format!("Failed to put user {} to RocksDB: {}", user_id, e);
                    eprintln!("[COMMIT_WRITE_TX_ERROR_PRINTLN] {}", err_msg);
                    NetworkError::msg(&err_msg)
                })?;
            println!(
                "[COMMIT_WRITE_TX_PRINTLN] Successfully wrote user {} to RocksDB.",
                user_id
            );
        }

        // Persist all domains from the in-memory map to RocksDB
        for (domain_id, domain) in self.domains.iter() {
            let domain_key = format!("domain::{}", domain_id);
            let serialized_domain = bincode::serialize(domain).map_err(|e| {
                let err_msg = format!("Failed to serialize domain {}: {}", domain_id, e); // domain_entry changed to domain
                eprintln!("[COMMIT_WRITE_TX_ERROR_PRINTLN] {}", err_msg);
                NetworkError::msg(&err_msg)
            })?;
            self.db
                .put(domain_key.as_bytes(), serialized_domain)
                .map_err(|e| {
                    let err_msg = format!("Failed to put domain {} to RocksDB: {}", domain_id, e);
                    eprintln!("[COMMIT_WRITE_TX_ERROR_PRINTLN] {}", err_msg);
                    NetworkError::msg(&err_msg)
                })?;
            println!(
                "[COMMIT_WRITE_TX_PRINTLN] Successfully wrote domain {} to RocksDB.",
                domain_id
            );
        }

        // Persist all workspaces from the in-memory map to RocksDB
        for (workspace_id, workspace) in self.workspaces.iter() {
            let workspace_key = format!("workspace::{}", workspace_id);
            let serialized_workspace = bincode::serialize(workspace).map_err(|e| {
                let err_msg = format!("Failed to serialize workspace {}: {}", workspace_id, e);
                eprintln!("[COMMIT_WRITE_TX_ERROR_PRINTLN] {}", err_msg);
                NetworkError::msg(&err_msg)
            })?;
            self.db
                .put(workspace_key.as_bytes(), serialized_workspace)
                .map_err(|e| {
                    let err_msg =
                        format!("Failed to put workspace {} to RocksDB: {}", workspace_id, e);
                    eprintln!("[COMMIT_WRITE_TX_ERROR_PRINTLN] {}", err_msg);
                    NetworkError::msg(&err_msg)
                })?;
            println!(
                "[COMMIT_WRITE_TX_PRINTLN] Successfully wrote workspace {} to RocksDB.",
                workspace_id
            );
        }

        Ok(())
    }

    fn get_user_role(&self, user_id: &str) -> Result<Option<UserRole>, NetworkError> {
        Ok(self.users.get(user_id).map(|u| u.role.clone()))
    }

    fn get_permissions(&self, user_id: &str) -> Result<Vec<Permission>, NetworkError> {
        let user = self
            .users
            .get(user_id)
            .ok_or_else(|| NetworkError::msg("User not found"))?;
        // This needs to be more sophisticated, collecting permissions from all relevant domains
        // For now, returning a placeholder or combined list from user.permissions
        let mut all_permissions = Vec::new();
        for perms in user.permissions.values() {
            all_permissions.extend(perms.clone());
        }
        all_permissions.dedup();
        Ok(all_permissions)
    }

    fn get_role(&self, role_id: &str) -> Result<Option<UserRole>, NetworkError> {
        // Roles are not stored as separate entities in this model, they are part of User struct
        // This function might need re-evaluation based on how roles are managed globally
        // For now, assuming role_id could be a string representation of UserRole enum
        match role_id {
            "Admin" => Ok(Some(UserRole::Admin)),
            "Owner" => Ok(Some(UserRole::Owner)),
            "Member" => Ok(Some(UserRole::Member)), // Added Member for completeness
            "Editor" => Ok(Some(UserRole::Member)), // Map Editor to Member
            "Viewer" => Ok(Some(UserRole::Member)), // Map Viewer to Member
            "Guest" => Ok(Some(UserRole::Guest)),
            "Banned" => Ok(Some(UserRole::Banned)), // Added Banned for completeness
            _ => Ok(None), // Custom roles or unknown roles will result in None
        }
    }

    fn create_role(&mut self, _role: UserRole) -> Result<(), NetworkError> {
        // Roles are not separate entities, this might be a no-op or error
        Err(NetworkError::msg(
            "Role creation is not supported directly; roles are assigned to users.",
        ))
    }

    fn delete_role(&mut self, _role_id: &str) -> Result<(), NetworkError> {
        // Roles are not separate entities, this might be a no-op or error
        Err(NetworkError::msg(
            "Role deletion is not supported directly.",
        ))
    }

    fn assign_role(&mut self, user_id: &str, role_id: &str) -> Result<(), NetworkError> {
        let user = self
            .users
            .get_mut(user_id)
            .ok_or_else(|| NetworkError::msg("User not found"))?;
        let role = match role_id {
            "Admin" => UserRole::Admin,
            "Owner" => UserRole::Owner,
            "Member" => UserRole::Member, // Added Member for completeness
            "Editor" => UserRole::Member, // Map Editor to Member
            "Viewer" => UserRole::Member, // Map Viewer to Member
            "Guest" => UserRole::Guest,
            "Banned" => UserRole::Banned, // Added Banned for completeness
            _ => return Err(NetworkError::msg(format!("Invalid role ID: {}", role_id))),
        };
        user.role = role;
        Ok(())
    }

    fn unassign_role(&mut self, user_id: &str, _role_id: &str) -> Result<(), NetworkError> {
        // Unassigning a role might mean setting it to a default, e.g., Guest
        let user = self
            .users
            .get_mut(user_id)
            .ok_or_else(|| NetworkError::msg("User not found"))?;
        user.role = UserRole::Guest; // Default to Guest or handle as per application logic
        Ok(())
    }
}

impl WorkspaceOperations for WriteTransaction<'_> {
    fn get_workspace(&self, workspace_id: &str) -> Option<&Workspace> {
        self.workspaces.get(workspace_id)
    }

    fn add_workspace(
        &mut self,
        workspace_id: &str,
        workspace: &mut Workspace,
    ) -> Result<(), NetworkError> {
        if self.workspaces.contains_key(workspace_id) {
            return Err(NetworkError::msg("Workspace already exists"));
        }
        self.workspaces
            .insert(workspace_id.to_string(), workspace.clone());
        Ok(())
    }

    fn remove_workspace(&mut self, workspace_id: &str) -> Result<(), NetworkError> {
        if self.workspaces.remove(workspace_id).is_none() {
            return Err(NetworkError::msg("Workspace not found"));
        }
        Ok(())
    }

    fn update_workspace(
        &mut self,
        workspace_id: &str,
        workspace: Workspace,
    ) -> Result<(), NetworkError> {
        if !self.workspaces.contains_key(workspace_id) {
            return Err(NetworkError::msg("Workspace not found for update"));
        }
        self.workspaces.insert(workspace_id.to_string(), workspace);
        Ok(())
    }
}
