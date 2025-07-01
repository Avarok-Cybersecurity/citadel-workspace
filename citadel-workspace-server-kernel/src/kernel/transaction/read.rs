use crate::kernel::transaction::{Transaction, WorkspaceOperations};
use citadel_logging::debug;
use citadel_sdk::prelude::NetworkError;
use citadel_workspace_types::structs::{
    Domain, Office, Permission, Room, User, UserRole, Workspace,
};
use parking_lot::RwLockReadGuard;
use std::collections::HashMap;

/// A read-only transaction
pub struct ReadTransaction<'a> {
    pub domains: RwLockReadGuard<'a, HashMap<String, Domain>>,
    pub users: RwLockReadGuard<'a, HashMap<String, User>>,
    pub workspaces: RwLockReadGuard<'a, HashMap<String, Workspace>>,
    pub workspace_password: RwLockReadGuard<'a, HashMap<String, String>>,
}

impl Transaction for ReadTransaction<'_> {
    fn workspace_password(&self, workspace_id: &str) -> Option<String> {
        self.workspace_password.get(workspace_id).cloned()
    }

    fn set_workspace_password(
        &mut self,
        _workspace_id: &str,
        _password: &str,
    ) -> Result<(), NetworkError> {
        Err(NetworkError::msg("Read transactions cannot modify data"))
    }

    fn get_domain(&self, domain_id: &str) -> Option<&Domain> {
        let domain_option = self.domains.get(domain_id);
        if let Some(domain) = domain_option {
            debug!(
                "ReadTransaction::get_domain - domain_id: {}, members: {:?}",
                domain_id,
                domain.members()
            );
        } else {
            debug!(
                "ReadTransaction::get_domain - domain_id: {} NOT FOUND",
                domain_id
            );
        }
        domain_option
    }

    fn get_domain_mut(&mut self, _domain_id: &str) -> Option<&mut Domain> {
        // ReadTransaction doesn't support mutable operations
        None
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

    fn get_workspace_mut(&mut self, _workspace_id: &str) -> Option<&mut Workspace> {
        // ReadTransaction doesn't support mutable operations
        None
    }

    fn get_all_workspaces(&self) -> &HashMap<String, Workspace> {
        &self.workspaces
    }

    fn get_office(&self, office_id: &str) -> Option<&Office> {
        if let Some(domain) = self.domains.get(office_id) {
            domain.as_office()
        } else {
            None
        }
    }

    fn get_office_mut(&mut self, _office_id: &str) -> Option<&mut Office> {
        // ReadTransaction doesn't support mutable operations
        None
    }

    fn get_room(&self, room_id: &str) -> Option<&Room> {
        if let Some(domain) = self.domains.get(room_id) {
            domain.as_room()
        } else {
            None
        }
    }

    fn get_room_mut(&mut self, _room_id: &str) -> Option<&mut Room> {
        // ReadTransaction doesn't support mutable operations
        None
    }

    fn get_user(&self, user_id: &str) -> Option<&User> {
        self.users.get(user_id)
    }

    fn get_user_mut(&mut self, _user_id: &str) -> Option<&mut User> {
        // ReadTransaction doesn't support mutable operations
        None
    }

    fn get_all_users(&self) -> &HashMap<String, User> {
        &self.users
    }

    fn is_member_of_domain(&self, user_id: &str, domain_id: &str) -> Result<bool, NetworkError> {
        let domain = self.get_domain(domain_id);
        match domain {
            Some(Domain::Office { office }) => Ok(office.members.contains(&user_id.to_string())),
            Some(Domain::Room { room }) => Ok(room.members.contains(&user_id.to_string())),
            Some(Domain::Workspace { workspace }) => {
                Ok(workspace.members.contains(&user_id.to_string()))
            }
            None => Err(NetworkError::msg(format!("Domain {} not found", domain_id))),
        }
    }

    fn insert_domain(&mut self, _domain_id: String, _domain: Domain) -> Result<(), NetworkError> {
        Err(NetworkError::msg("Read transactions cannot modify data"))
    }

    fn insert_workspace(
        &mut self,
        _workspace_id: String,
        _workspace: Workspace,
    ) -> Result<(), NetworkError> {
        Err(NetworkError::msg("Read transactions cannot modify data"))
    }

    fn insert_office(&mut self, _office_id: String, _office: Office) -> Result<(), NetworkError> {
        Err(NetworkError::msg("Read transactions cannot modify data"))
    }

    fn insert_room(&mut self, _room_id: String, _room: Room) -> Result<(), NetworkError> {
        Err(NetworkError::msg("Read transactions cannot modify data"))
    }

    fn insert_user(&mut self, _user_id: String, _user: User) -> Result<(), NetworkError> {
        Err(NetworkError::msg("Read transactions cannot modify data"))
    }

    fn update_domain(&mut self, _domain_id: &str, _new_domain: Domain) -> Result<(), NetworkError> {
        Err(NetworkError::msg("Read transactions cannot modify data"))
    }

    fn update_workspace(
        &mut self,
        _workspace_id: &str,
        _new_workspace: Workspace,
    ) -> Result<(), NetworkError> {
        Err(NetworkError::msg("Read transactions cannot modify data"))
    }

    fn update_user(&mut self, _user_id: &str, _new_user: User) -> Result<(), NetworkError> {
        Err(NetworkError::msg("Read transactions cannot modify data"))
    }

    fn remove_domain(&mut self, _domain_id: &str) -> Result<Option<Domain>, NetworkError> {
        Err(NetworkError::msg("Read transactions cannot modify data"))
    }

    fn remove_workspace(&mut self, _workspace_id: &str) -> Result<Option<Workspace>, NetworkError> {
        Err(NetworkError::msg("Read transactions cannot modify data"))
    }

    fn remove_office(&mut self, _office_id: &str) -> Result<(), NetworkError> {
        Err(NetworkError::msg("Read transactions cannot modify data"))
    }

    fn remove_room(&mut self, _room_id: &str) -> Result<(), NetworkError> {
        Err(NetworkError::msg("Read transactions cannot modify data"))
    }

    fn remove_user(&mut self, _user_id: &str) -> Result<Option<User>, NetworkError> {
        Err(NetworkError::msg("Read transactions cannot modify data"))
    }

    fn list_workspaces(&self, user_id: &str) -> Result<Vec<Workspace>, NetworkError> {
        let mut workspaces = Vec::new();
        for workspace in self.workspaces.values() {
            if workspace.members.contains(&user_id.to_string()) {
                workspaces.push(workspace.clone());
            }
        }
        Ok(workspaces)
    }

    fn list_offices(
        &self,
        user_id: &str,
        workspace_id: Option<String>,
    ) -> Result<Vec<Office>, NetworkError> {
        let mut offices = Vec::new();
        for domain in self.domains.values() {
            if let Some(office) = domain.as_office() {
                // Check if user is a member of this office
                if office.members.contains(&user_id.to_string()) {
                    // If workspace_id is specified, filter by it
                    if let Some(ref wid) = workspace_id {
                        if office.workspace_id == *wid {
                            offices.push(office.clone());
                        }
                    } else {
                        offices.push(office.clone());
                    }
                }
            }
        }
        Ok(offices)
    }

    fn list_rooms(
        &self,
        user_id: &str,
        office_id: Option<String>,
    ) -> Result<Vec<Room>, NetworkError> {
        let mut rooms = Vec::new();
        for domain in self.domains.values() {
            if let Some(room) = domain.as_room() {
                // Check if user is a member of this room
                if room.members.contains(&user_id.to_string()) {
                    // If office_id is specified, filter by it
                    if let Some(ref oid) = office_id {
                        if room.office_id == *oid {
                            rooms.push(room.clone());
                        }
                    } else {
                        rooms.push(room.clone());
                    }
                }
            }
        }
        Ok(rooms)
    }

    fn add_user_to_domain(
        &mut self,
        _user_id: &str,
        _domain_id: &str,
        _role: UserRole,
    ) -> Result<(), NetworkError> {
        Err(NetworkError::msg("Read transactions cannot modify data"))
    }

    fn remove_user_from_domain(
        &mut self,
        _user_id: &str,
        _domain_id: &str,
    ) -> Result<(), NetworkError> {
        Err(NetworkError::msg("Read transactions cannot modify data"))
    }

    fn get_user_role(&self, user_id: &str) -> Result<Option<UserRole>, NetworkError> {
        if let Some(user) = self.get_user(user_id) {
            Ok(Some(user.role.clone()))
        } else {
            Ok(None)
        }
    }

    fn get_permissions(&self, _user_id: &str) -> Result<Vec<Permission>, NetworkError> {
        // TODO: Implement proper permission retrieval logic based on roles
        Ok(vec![]) // Placeholder
    }

    fn get_role(&self, _role_id: &str) -> Result<Option<UserRole>, NetworkError> {
        // TODO: Implement role retrieval, possibly from a dedicated roles map
        Ok(None) // Placeholder
    }

    fn create_role(&mut self, _role: UserRole) -> Result<(), NetworkError> {
        Err(NetworkError::msg("Read transactions cannot modify data"))
    }

    fn delete_role(&mut self, _role_id: &str) -> Result<(), NetworkError> {
        Err(NetworkError::msg("Read transactions cannot modify data"))
    }

    fn assign_role(&mut self, _user_id: &str, _role_id: &str) -> Result<(), NetworkError> {
        Err(NetworkError::msg("Read transactions cannot modify data"))
    }

    fn unassign_role(&mut self, _user_id: &str, _role_id: &str) -> Result<(), NetworkError> {
        Err(NetworkError::msg("Read transactions cannot modify data"))
    }
}

impl<'a> ReadTransaction<'a> {
    /// Create a new read transaction
    pub fn new(
        domains: RwLockReadGuard<'a, HashMap<String, Domain>>,
        users: RwLockReadGuard<'a, HashMap<String, User>>,
        workspaces: RwLockReadGuard<'a, HashMap<String, Workspace>>,
        workspace_password: RwLockReadGuard<'a, HashMap<String, String>>,
    ) -> Self {
        ReadTransaction {
            domains,
            users,
            workspaces,
            workspace_password,
        }
    }
}

impl WorkspaceOperations for ReadTransaction<'_> {
    fn get_workspace(&self, workspace_id: &str) -> Option<&Workspace> {
        self.workspaces.get(workspace_id)
    }

    fn add_workspace(
        &mut self,
        _workspace_id: &str,
        _workspace: &mut Workspace,
    ) -> Result<(), NetworkError> {
        Err(NetworkError::msg(
            "Cannot add workspace in a read transaction",
        ))
    }

    fn remove_workspace(&mut self, _workspace_id: &str) -> Result<(), NetworkError> {
        Err(NetworkError::msg(
            "Cannot remove workspace in a read transaction",
        ))
    }

    fn update_workspace(
        &mut self,
        _workspace_id: &str,
        _workspace: Workspace,
    ) -> Result<(), NetworkError> {
        Err(NetworkError::msg(
            "Cannot update workspace in a read transaction",
        ))
    }
}
