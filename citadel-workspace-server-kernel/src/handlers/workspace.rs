use crate::handlers::domain::DomainEntity;
use crate::handlers::transaction::Transaction;
use crate::kernel::WorkspaceServerKernel;
use citadel_logging::{debug, info};
use citadel_sdk::prelude::{NetworkError, Ratchet};
use citadel_workspace_types::structs::{Domain, Office, Permission, Workspace};
use uuid::Uuid;

/// Implementation of Workspace operations for the server kernel
impl<R: Ratchet> WorkspaceServerKernel<R> {
    /// Create a new workspace
    pub fn create_workspace(
        &self,
        user_id: &str,
        name: &str,
        description: &str,
        metadata: Option<Vec<u8>>,
    ) -> Result<Workspace, NetworkError> {
        // Check if user has permission to create a workspace
        if !self.is_admin(user_id) && !self.check_entity_permission(user_id, "", Permission::All)? {
            return Err(NetworkError::msg(
                "Permission denied: Only admins can create workspaces",
            ));
        }

        let workspace_id = Uuid::new_v4().to_string();
        
        let workspace = Workspace {
            id: workspace_id.clone(),
            name: name.to_string(),
            description: description.to_string(),
            owner_id: user_id.to_string(),
            members: vec![user_id.to_string()],
            offices: Vec::new(),
            metadata: metadata.unwrap_or_default(),
        };

        // Store the workspace using transaction manager
        self.with_write_transaction(|tx| {
            tx.insert_workspace(workspace_id.clone(), workspace.clone())?;
            Ok(())
        })?;

        info!(target: "citadel", "User {} created workspace {}", user_id, workspace_id);
        Ok(workspace)
    }

    /// Get a workspace by ID
    pub fn get_workspace(&self, user_id: &str, workspace_id: &str) -> Result<Workspace, NetworkError> {
        // Check if user has permission to view this workspace
        self.with_read_transaction(|tx| {
            if let Some(workspace) = tx.get_workspace(workspace_id) {
                // Admins and workspace members can view the workspace
                if self.is_admin(user_id) || workspace.members.contains(&user_id.to_string()) {
                    Ok(workspace.clone())
                } else {
                    Err(NetworkError::msg("Permission denied: Not a member of this workspace"))
                }
            } else {
                Err(NetworkError::msg(format!("Workspace {} not found", workspace_id)))
            }
        })
    }

    /// Update a workspace
    pub fn update_workspace(
        &self,
        user_id: &str,
        workspace_id: &str,
        name: Option<&str>,
        description: Option<&str>,
        metadata: Option<Vec<u8>>,
    ) -> Result<Workspace, NetworkError> {
        // Check if user has permission to update this workspace
        if !self.is_admin(user_id) {
            let is_owner = self.with_read_transaction(|tx| {
                if let Some(workspace) = tx.get_workspace(workspace_id) {
                    Ok(workspace.owner_id == user_id)
                } else {
                    Err(NetworkError::msg(format!("Workspace {} not found", workspace_id)))
                }
            })?;

            if !is_owner {
                return Err(NetworkError::msg(
                    "Permission denied: Only admins or workspace owners can update workspaces",
                ));
            }
        }

        // Update the workspace
        self.with_write_transaction(|tx| {
            let mut workspace = if let Some(workspace) = tx.get_workspace(workspace_id).cloned() {
                workspace
            } else {
                return Err(NetworkError::msg(format!("Workspace {} not found", workspace_id)));
            };

            // Update fields if provided
            if let Some(name) = name {
                workspace.name = name.to_string();
            }

            if let Some(description) = description {
                workspace.description = description.to_string();
            }

            if let Some(md) = metadata {
                workspace.metadata = md;
            }

            // Save updated workspace
            tx.update_workspace(workspace_id, workspace.clone())?;
            Ok(workspace)
        })
    }

    /// Delete a workspace
    pub fn delete_workspace(&self, user_id: &str, workspace_id: &str) -> Result<(), NetworkError> {
        // Check if user has permission to delete this workspace
        if !self.is_admin(user_id) {
            let is_owner = self.with_read_transaction(|tx| {
                if let Some(workspace) = tx.get_workspace(workspace_id) {
                    Ok(workspace.owner_id == user_id)
                } else {
                    Err(NetworkError::msg(format!("Workspace {} not found", workspace_id)))
                }
            })?;

            if !is_owner {
                return Err(NetworkError::msg(
                    "Permission denied: Only admins or workspace owners can delete workspaces",
                ));
            }
        }

        // Get workspace first to know which offices to remove
        let workspace = self.get_workspace(user_id, workspace_id)?;
        
        // Delete the workspace and all its offices
        self.with_write_transaction(|tx| {
            // First remove all offices in this workspace
            for office_id in &workspace.offices {
                if let Some(domain) = tx.get_domain(office_id) {
                    if let Domain::Office { office } = domain {
                        // Remove all rooms in this office
                        for room_id in &office.rooms {
                            tx.remove_domain(room_id)?;
                        }
                    }
                    // Remove the office itself
                    tx.remove_domain(office_id)?;
                }
            }
            
            // Finally remove the workspace
            tx.remove_workspace(workspace_id)?;
            Ok(())
        })
    }

    /// List all workspaces accessible to a user
    pub fn list_workspaces(&self, user_id: &str) -> Result<Vec<Workspace>, NetworkError> {
        self.with_read_transaction(|tx| {
            let mut workspaces = Vec::new();
            let is_admin = self.is_admin(user_id);

            // Get all workspaces
            for workspace in tx.get_all_workspaces().values() {
                // If user is admin or a member of the workspace, add it to the list
                if is_admin || workspace.members.contains(&user_id.to_string()) {
                    workspaces.push(workspace.clone());
                }
            }

            Ok(workspaces)
        })
    }
    
    /// Add an office to a workspace
    pub fn add_office_to_workspace(
        &self,
        user_id: &str,
        workspace_id: &str,
        office_id: &str,
    ) -> Result<(), NetworkError> {
        // Check if user has permission to update this workspace
        if !self.is_admin(user_id) {
            let is_owner = self.with_read_transaction(|tx| {
                if let Some(workspace) = tx.get_workspace(workspace_id) {
                    Ok(workspace.owner_id == user_id)
                } else {
                    Err(NetworkError::msg(format!("Workspace {} not found", workspace_id)))
                }
            })?;

            if !is_owner {
                return Err(NetworkError::msg(
                    "Permission denied: Only admins or workspace owners can update workspaces",
                ));
            }
        }

        // Update the workspace to include the office
        self.with_write_transaction(|tx| {
            // Verify both workspace and office exist
            let mut workspace = if let Some(workspace) = tx.get_workspace(workspace_id).cloned() {
                workspace
            } else {
                return Err(NetworkError::msg(format!("Workspace {} not found", workspace_id)));
            };

            if tx.get_domain(office_id).is_none() {
                return Err(NetworkError::msg(format!("Office {} not found", office_id)));
            }

            // Add office to workspace if not already present
            if !workspace.offices.contains(&office_id.to_string()) {
                workspace.offices.push(office_id.to_string());
                tx.update_workspace(workspace_id, workspace)?;
            }

            Ok(())
        })
    }

    /// Remove an office from a workspace
    pub fn remove_office_from_workspace(
        &self,
        user_id: &str,
        workspace_id: &str,
        office_id: &str,
    ) -> Result<(), NetworkError> {
        // Check if user has permission to update this workspace
        if !self.is_admin(user_id) {
            let is_owner = self.with_read_transaction(|tx| {
                if let Some(workspace) = tx.get_workspace(workspace_id) {
                    Ok(workspace.owner_id == user_id)
                } else {
                    Err(NetworkError::msg(format!("Workspace {} not found", workspace_id)))
                }
            })?;

            if !is_owner {
                return Err(NetworkError::msg(
                    "Permission denied: Only admins or workspace owners can update workspaces",
                ));
            }
        }

        // Update the workspace to remove the office
        self.with_write_transaction(|tx| {
            let mut workspace = if let Some(workspace) = tx.get_workspace(workspace_id).cloned() {
                workspace
            } else {
                return Err(NetworkError::msg(format!("Workspace {} not found", workspace_id)));
            };

            // Remove office from workspace
            workspace.offices.retain(|id| id != office_id);
            tx.update_workspace(workspace_id, workspace)?;

            Ok(())
        })
    }

    /// Get a list of offices in a workspace
    pub fn list_offices_in_workspace(
        &self,
        user_id: &str,
        workspace_id: &str,
    ) -> Result<Vec<Office>, NetworkError> {
        // Check if user has permission to view this workspace
        let workspace = self.get_workspace(user_id, workspace_id)?;
        
        self.with_read_transaction(|tx| {
            let mut offices = Vec::new();
            
            // Get all offices in this workspace
            for office_id in &workspace.offices {
                if let Some(domain) = tx.get_domain(office_id) {
                    if let Domain::Office { office } = domain {
                        // If user is admin, owner, or a member of the office, add it to the list
                        if self.is_admin(user_id) || office.owner_id == user_id || 
                           office.members.contains(&user_id.to_string()) {
                            offices.push(office.clone());
                        }
                    }
                }
            }
            
            Ok(offices)
        })
    }

    /// Add a user to a workspace
    pub fn add_user_to_workspace(
        &self,
        admin_id: &str,
        user_id: &str,
        workspace_id: &str,
    ) -> Result<(), NetworkError> {
        // Check if admin has permission to add users
        if !self.is_admin(admin_id) {
            let is_owner = self.with_read_transaction(|tx| {
                if let Some(workspace) = tx.get_workspace(workspace_id) {
                    Ok(workspace.owner_id == admin_id)
                } else {
                    Err(NetworkError::msg(format!("Workspace {} not found", workspace_id)))
                }
            })?;

            if !is_owner {
                return Err(NetworkError::msg(
                    "Permission denied: Only admins or workspace owners can add users",
                ));
            }
        }

        // Add user to workspace
        self.with_write_transaction(|tx| {
            let mut workspace = if let Some(workspace) = tx.get_workspace(workspace_id).cloned() {
                workspace
            } else {
                return Err(NetworkError::msg(format!("Workspace {} not found", workspace_id)));
            };

            // Check if user exists
            if tx.get_user(user_id).is_none() {
                return Err(NetworkError::msg(format!("User {} not found", user_id)));
            }

            // Add user to workspace if not already a member
            if !workspace.members.contains(&user_id.to_string()) {
                workspace.members.push(user_id.to_string());
                tx.update_workspace(workspace_id, workspace)?;
            }

            Ok(())
        })
    }

    /// Remove a user from a workspace
    pub fn remove_user_from_workspace(
        &self,
        admin_id: &str,
        user_id: &str,
        workspace_id: &str,
    ) -> Result<(), NetworkError> {
        // Check if admin has permission to remove users
        if !self.is_admin(admin_id) {
            let is_owner = self.with_read_transaction(|tx| {
                if let Some(workspace) = tx.get_workspace(workspace_id) {
                    Ok(workspace.owner_id == admin_id)
                } else {
                    Err(NetworkError::msg(format!("Workspace {} not found", workspace_id)))
                }
            })?;

            if !is_owner {
                return Err(NetworkError::msg(
                    "Permission denied: Only admins or workspace owners can remove users",
                ));
            }
        }

        // Remove user from workspace
        self.with_write_transaction(|tx| {
            let mut workspace = if let Some(workspace) = tx.get_workspace(workspace_id).cloned() {
                workspace
            } else {
                return Err(NetworkError::msg(format!("Workspace {} not found", workspace_id)));
            };

            // Cannot remove the owner
            if workspace.owner_id == user_id {
                return Err(NetworkError::msg("Cannot remove the workspace owner"));
            }

            // Remove user from workspace
            workspace.members.retain(|id| id != user_id);
            tx.update_workspace(workspace_id, workspace)?;

            Ok(())
        })
    }

    /// Get the workspace that contains a specific office
    pub fn get_workspace_for_office(
        &self,
        user_id: &str,
        office_id: &str,
    ) -> Result<Option<Workspace>, NetworkError> {
        // Verify the user has access to this office
        let _ = self.get_office(user_id, office_id)?;
        
        self.with_read_transaction(|tx| {
            for workspace in tx.get_all_workspaces().values() {
                if workspace.offices.contains(&office_id.to_string()) {
                    return Ok(Some(workspace.clone()));
                }
            }
            
            Ok(None)
        })
    }

    /// Load the workspace hierarchy for a user, including all workspaces, offices, and rooms they have access to
    pub fn load_workspace_hierarchy(&self, user_id: &str) -> Result<Workspace, NetworkError> {
        // Verify the user exists
        if !self.user_exists(user_id) {
            return Err(NetworkError::msg("User does not exist"));
        }

        // Get all workspaces this user has access to
        let workspaces = self.with_read_transaction(|tx| {
            let all_workspaces = tx.get_all_workspaces();
            let mut user_workspaces = Vec::new();
            
            // Filter workspaces this user has access to
            for (_, workspace) in all_workspaces {
                if workspace.owner_id == user_id || workspace.members.contains(&user_id.to_string()) {
                    user_workspaces.push(workspace.clone());
                }
            }
            
            if user_workspaces.is_empty() {
                // No workspaces - the user might only have access to specific offices or rooms
                return Ok(None);
            }
            
            // Return the first workspace as the active one
            Ok(Some(user_workspaces[0].clone()))
        })?;
        
        // If no workspaces found, we need to check for direct office access
        if let Some(workspace) = workspaces {
            Ok(workspace)
        } else {
            // Create a virtual workspace containing all offices the user has access to
            self.with_read_transaction(|tx| {
                let mut virtual_workspace = Workspace {
                    id: format!("virtual-workspace-{}", user_id),
                    name: "My Workspace".to_string(),
                    description: "Collection of your accessible offices".to_string(),
                    owner_id: user_id.to_string(),
                    members: vec![user_id.to_string()],
                    offices: Vec::new(),
                    metadata: Vec::new(),
                };
                
                // Find all offices the user has access to
                for (id, domain) in tx.get_all_domains() {
                    if let Domain::Office { office } = domain {
                        if office.owner_id == user_id || office.members.contains(&user_id.to_string()) {
                            virtual_workspace.offices.push(id.clone());
                        }
                    }
                }
                
                if virtual_workspace.offices.is_empty() {
                    Err(NetworkError::msg("User does not have access to any workspaces or offices"))
                } else {
                    Ok(virtual_workspace)
                }
            })
        }
    }
}
