use crate::kernel::transaction::{Transaction, WorkspaceOperations};
use citadel_sdk::prelude::NetworkError;
use citadel_workspace_types::structs::{Domain, Permission, User, UserRole, Workspace};
use parking_lot::RwLockReadGuard;
use std::collections::HashMap;
use citadel_logging::debug;

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
            debug!("ReadTransaction::get_domain - domain_id: {} NOT FOUND", domain_id);
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

    fn remove_user(&mut self, _user_id: &str) -> Result<Option<User>, NetworkError> {
        Err(NetworkError::msg("Read transactions cannot modify data"))
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
