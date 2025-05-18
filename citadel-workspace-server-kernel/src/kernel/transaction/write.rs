use citadel_sdk::prelude::NetworkError;
use citadel_workspace_types::structs::{Domain, Permission, User, UserRole, Workspace};
use std::collections::HashMap;
use parking_lot::RwLockWriteGuard;
use crate::kernel::transaction::{DomainChange, Transaction, UserChange, WorkspaceChange, WorkspaceOperations};

/// A writable transaction that can modify domains and users
pub struct WriteTransaction<'a> {
    pub domains: RwLockWriteGuard<'a, HashMap<String, Domain>>,
    pub users: RwLockWriteGuard<'a, HashMap<String, User>>,
    pub workspaces: RwLockWriteGuard<'a, HashMap<String, Workspace>>,
    pub workspace_password: RwLockWriteGuard<'a, HashMap<String, String>>,
    pub domain_changes: Vec<DomainChange>,
    pub user_changes: Vec<UserChange>,
    pub workspace_changes: Vec<WorkspaceChange>,
}

impl Transaction for WriteTransaction<'_> {
    fn workspace_password(&self, workspace_id: &str) -> Option<String> {
        self.workspace_password.get(workspace_id).cloned()
    }

    fn set_workspace_password(&mut self, workspace_id: &str, password: &str) -> Result<(), NetworkError> {
        self.workspace_password.insert(workspace_id.to_string(), password.to_string());
        Ok(())
    }

    fn get_domain(&self, domain_id: &str) -> Option<&Domain> {
        self.domains.get(domain_id)
    }

    fn get_domain_mut(&mut self, domain_id: &str) -> Option<&mut Domain> {
        self.domains.get_mut(domain_id)
    }

    fn get_all_domains(&self) -> &HashMap<String, Domain> {
        &self.domains
    }

    fn get_workspace(&self, workspace_id: &str) -> Option<&Workspace> {
        self.workspaces.get(workspace_id)
    }

    fn get_workspace_mut(&mut self, workspace_id: &str) -> Option<&mut Workspace> {
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

    fn insert_domain(&mut self, domain_id: String, domain: Domain) -> Result<(), NetworkError> {
        // Record the change for potential rollback
        self.domain_changes
            .push(DomainChange::Insert(domain_id.clone()));

        // Handle special cases for workspace domains
        if let Domain::Workspace { workspace } = &domain {
            // Also insert into the workspaces collection
            self.workspaces.insert(domain_id.clone(), workspace.clone());
        }

        // Insert the domain
        self.domains.insert(domain_id, domain);
        Ok(())
    }

    fn insert_workspace(
        &mut self,
        workspace_id: String,
        workspace: Workspace,
    ) -> Result<(), NetworkError> {
        // Record the change for potential rollback
        self.workspace_changes
            .push(WorkspaceChange::Insert(workspace_id.clone()));

        // Insert the workspace
        self.workspaces.insert(workspace_id, workspace);
        Ok(())
    }

    fn insert_user(&mut self, user_id: String, user: User) -> Result<(), NetworkError> {
        // Record the change for potential rollback
        self.user_changes.push(UserChange::Insert(user_id.clone()));

        // Insert the user
        self.users.insert(user_id, user);
        Ok(())
    }

    fn update_domain(&mut self, domain_id: &str, new_domain: Domain) -> Result<(), NetworkError> {
        // Check if domain exists
        let old_domain = if let Some(old_domain) = self.domains.get(domain_id).cloned() {
            old_domain
        } else {
            return Err(NetworkError::msg(format!("Domain {} not found", domain_id)));
        };

        // Record the change for potential rollback
        self.domain_changes
            .push(DomainChange::Update(domain_id.to_string(), old_domain));

        // Update the domain
        self.domains.insert(domain_id.to_string(), new_domain);
        Ok(())
    }

    fn update_workspace(
        &mut self,
        workspace_id: &str,
        new_workspace: Workspace,
    ) -> Result<(), NetworkError> {
        // Check if workspace exists
        let old_workspace = if let Some(old_workspace) = self.workspaces.get(workspace_id).cloned()
        {
            old_workspace
        } else {
            return Err(NetworkError::msg(format!(
                "Workspace {} not found",
                workspace_id
            )));
        };

        // Record the change for potential rollback
        self.workspace_changes.push(WorkspaceChange::Update(
            workspace_id.to_string(),
            old_workspace,
        ));

        // Update the workspace
        self.workspaces
            .insert(workspace_id.to_string(), new_workspace);
        Ok(())
    }

    fn update_user(&mut self, user_id: &str, new_user: User) -> Result<(), NetworkError> {
        // Check if user exists
        let old_user = if let Some(old_user) = self.users.get(user_id).cloned() {
            old_user
        } else {
            return Err(NetworkError::msg(format!("User {} not found", user_id)));
        };

        // Record the change for potential rollback
        self.user_changes
            .push(UserChange::Update(user_id.to_string(), old_user));

        // Update the user
        self.users.insert(user_id.to_string(), new_user);
        Ok(())
    }

    fn remove_domain(&mut self, domain_id: &str) -> Result<Option<Domain>, NetworkError> {
        // Save the current state for rollback
        let domain = match self.domains.get(domain_id) {
            Some(domain) => {
                // Record the change for potential rollback
                self.domain_changes
                    .push(DomainChange::Remove(domain_id.to_string(), domain.clone()));
                domain.clone()
            }
            None => {
                return Err(NetworkError::msg(format!(
                    "Domain {} does not exist",
                    domain_id
                )))
            }
        };

        // Also remove from workspaces collection if it's a workspace
        if let Domain::Workspace { .. } = domain {
            self.workspaces.remove(domain_id);
        }

        // Remove the domain
        self.domains.remove(domain_id);
        Ok(Some(domain))
    }

    fn remove_workspace(&mut self, workspace_id: &str) -> Result<Option<Workspace>, NetworkError> {
        // Check if workspace exists and remove it
        if let Some(old_workspace) = self.workspaces.remove(workspace_id) {
            // Record the change for potential rollback
            self.workspace_changes.push(WorkspaceChange::Remove(
                workspace_id.to_string(),
                old_workspace.clone(),
            ));

            Ok(Some(old_workspace))
        } else {
            Ok(None)
        }
    }

    fn remove_user(&mut self, user_id: &str) -> Result<Option<User>, NetworkError> {
        // Check if user exists and remove it
        if let Some(old_user) = self.users.remove(user_id) {
            // Record the change for potential rollback
            self.user_changes
                .push(UserChange::Remove(user_id.to_string(), old_user.clone()));

            Ok(Some(old_user))
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
        // Check if domain exists
        let domain = self
            .get_domain(domain_id)
            .ok_or_else(|| NetworkError::msg(format!("Domain {} not found", domain_id)))?
            .clone();

        // Make sure the user exists
        let mut user = if let Some(user) = self.get_user(user_id).cloned() {
            user
        } else {
            return Err(NetworkError::msg(format!("User {} not found", user_id)));
        };

        // Set the user's role
        user.role = role;

        // Update the user in the store
        self.update_user(user_id, user)?;

        // Update domain with the new member
        let updated_domain = match domain {
            Domain::Office { mut office } => {
                if !office.members.contains(&user_id.to_string()) {
                    office.members.push(user_id.to_string());
                }
                Domain::Office { office }
            }
            Domain::Room { mut room } => {
                if !room.members.contains(&user_id.to_string()) {
                    room.members.push(user_id.to_string());
                }
                Domain::Room { room }
            }
            Domain::Workspace { mut workspace } => {
                if !workspace.members.contains(&user_id.to_string()) {
                    workspace.members.push(user_id.to_string());
                }
                Domain::Workspace { workspace }
            }
        };

        // Update the domain
        self.update_domain(domain_id, updated_domain)
    }

    fn remove_user_from_domain(
        &mut self,
        user_id: &str,
        domain_id: &str,
    ) -> Result<(), NetworkError> {
        // Check if domain exists
        let domain = self
            .get_domain(domain_id)
            .ok_or_else(|| NetworkError::msg(format!("Domain {} not found", domain_id)))?
            .clone();

        // Update domain without the user
        let updated_domain = match domain {
            Domain::Office { mut office } => {
                office.members.retain(|id| id != user_id);
                Domain::Office { office }
            }
            Domain::Room { mut room } => {
                room.members.retain(|id| id != user_id);
                Domain::Room { room }
            }
            Domain::Workspace { mut workspace } => {
                workspace.members.retain(|id| id != user_id);
                Domain::Workspace { workspace }
            }
        };

        // Update the domain
        self.update_domain(domain_id, updated_domain)
    }

    fn commit(&self) -> Result<(), NetworkError> {
        // Nothing to do here, changes are automatically committed when the transaction is dropped
        Ok(())
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
        // TODO: Implement role creation logic
        Ok(())
    }

    fn delete_role(&mut self, _role_id: &str) -> Result<(), NetworkError> {
        // TODO: Implement role deletion logic
        Ok(())
    }

    fn assign_role(&mut self, _user_id: &str, _role_id: &str) -> Result<(), NetworkError> {
        // TODO: Implement role assignment logic
        Ok(())
    }

    fn unassign_role(&mut self, _user_id: &str, _role_id: &str) -> Result<(), NetworkError> {
        // TODO: Implement role unassignment logic
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
        // Add the workspace to the domain index
        let domain = Domain::Workspace {
            workspace: workspace.clone(),
        };
        self.insert_domain(workspace_id.to_string(), domain)?;

        // Add to the workspace map
        self.workspaces
            .insert(workspace_id.to_string(), workspace.clone());

        Ok(())
    }

    fn remove_workspace(&mut self, workspace_id: &str) -> Result<(), NetworkError> {
        // Remove from the domain index
        self.remove_domain(workspace_id)?;

        // Remove from the workspace map
        self.workspaces.remove(workspace_id);

        Ok(())
    }

    fn update_workspace(
        &mut self,
        workspace_id: &str,
        workspace: Workspace,
    ) -> Result<(), NetworkError> {
        // Update the domain index
        let domain = Domain::Workspace {
            workspace: workspace.clone(),
        };
        self.update_domain(workspace_id, domain)?;

        // Update the workspace map
        self.workspaces.insert(workspace_id.to_string(), workspace);

        Ok(())
    }
}

impl<'a> WriteTransaction<'a> {
    /// Create a new write transaction
    pub fn new(
        domains: RwLockWriteGuard<'a, HashMap<String, Domain>>,
        users: RwLockWriteGuard<'a, HashMap<String, User>>,
        workspaces: RwLockWriteGuard<'a, HashMap<String, Workspace>>,
        workspace_password: RwLockWriteGuard<'a, HashMap<String, String>>,
    ) -> Self {
        WriteTransaction {
            domains,
            users,
            workspaces,
            workspace_password,
            domain_changes: Vec::new(),
            user_changes: Vec::new(),
            workspace_changes: Vec::new(),
        }
    }

    /// Roll back any changes made in this transaction
    pub fn rollback(mut self) {
        // Rollback domain changes in reverse order
        for change in self.domain_changes.iter().rev() {
            match change {
                DomainChange::Insert(id) => {
                    let _ = self.domains.remove(id);
                }
                DomainChange::Update(id, old_domain) => {
                    let _ = self.domains.insert(id.clone(), old_domain.clone());
                }
                DomainChange::Remove(id, old_domain) => {
                    let _ = self.domains.insert(id.clone(), old_domain.clone());
                }
            }
        }

        // Rollback workspace changes in reverse order
        for change in self.workspace_changes.iter().rev() {
            match change {
                WorkspaceChange::Insert(id) => {
                    let _ = self.workspaces.remove(id);
                }
                WorkspaceChange::Update(id, old_workspace) => {
                    let _ = self.workspaces.insert(id.clone(), old_workspace.clone());
                }
                WorkspaceChange::Remove(id, old_workspace) => {
                    let _ = self.workspaces.insert(id.clone(), old_workspace.clone());
                }
            }
        }

        // Rollback user changes in reverse order
        for change in self.user_changes.iter().rev() {
            match change {
                UserChange::Insert(id) => {
                    let _ = self.users.remove(id);
                }
                UserChange::Update(id, old_user) => {
                    let _ = self.users.insert(id.clone(), old_user.clone());
                }
                UserChange::Remove(id, old_user) => {
                    let _ = self.users.insert(id.clone(), old_user.clone());
                }
            }
        }
    }
}