use citadel_sdk::prelude::*;
use citadel_workspace_types::structs::{Domain, Office, Permission, Workspace};
use crate::handlers::domain::DomainOperations;
use crate::handlers::domain::server_ops::ServerDomainOps;
use crate::kernel::transaction::Transaction;

impl<R: Ratchet> ServerDomainOps<R> {
    pub(crate) fn create_office_inner(&self, user_id: &str, name: &str, description: &str, mdx_content: Option<&str>) -> Result<Office, NetworkError> {
        // Check if user has permission to create offices
        let workspace_id = crate::WORKSPACE_ROOT_ID;
    
        // Check if user is admin, workspace owner, or has CreateOffice permission
        let is_authorized = self.with_read_transaction(|tx| {
            if self.tx_manager.is_admin(user_id) {
                return Ok(true);
            }
    
            // Check if user is workspace owner
            if let Some(domain) = tx.get_domain(&workspace_id) {
                if let Domain::Workspace { workspace } = domain {
                    if workspace.owner_id == user_id {
                        return Ok(true);
                    }
                }
            }
    
            // Check if user has CreateOffice permission
            Ok(self
                .check_entity_permission(user_id, &workspace_id, Permission::CreateOffice)
                .unwrap_or(false))
        })?;
    
        if !is_authorized {
            return Err(NetworkError::msg("Permission denied: Cannot create office. Must be admin, workspace owner, or have CreateOffice permission"));
        }
    
        self.with_write_transaction(|tx| {
            // Generate ID for the new office
            let office_id = uuid::Uuid::new_v4().to_string();
    
            // Create the office
            let office = Office {
                id: office_id.clone(),
                name: name.to_string(),
                description: description.to_string(),
                owner_id: user_id.to_string(),
                members: vec![user_id.to_string()], // Owner is automatically a member
                rooms: Vec::new(),                  // Initialize with empty rooms
                mdx_content: mdx_content.unwrap_or_default().to_string(), // Use provided MDX content or empty string
                metadata: Vec::new(),
            };
    
            // Insert into domains
            tx.insert_domain(
                office_id,
                Domain::Office {
                    office: office.clone(),
                },
            )?;
    
            Ok(office)
        })
    }

    pub fn list_office_in_workspace_inner(&self, user_id: &str) -> Result<Vec<Office>, NetworkError> {
        // Use the fixed workspace ID, ignoring the provided workspace_id parameter
        let workspace_id = crate::WORKSPACE_ROOT_ID;

        self.with_read_transaction(|tx| {
            match tx.get_domain(workspace_id) {
                Some(Domain::Workspace { workspace }) => {
                    // Check if user has permission to view this workspace
                    if self.tx_manager.is_admin(user_id)
                        || workspace.owner_id == user_id
                        || workspace.members.contains(&user_id.to_string())
                    {
                        // List all offices - with the single workspace model, all offices belong to the workspace
                        let offices: Vec<Office> = tx
                            .get_all_domains()
                            .iter()
                            .filter_map(|(_, domain)| match domain {
                                Domain::Office { office } => {
                                    // All offices belong to the single workspace, so no need to check workspace_id
                                    Some(office.clone())
                                }
                                _ => None,
                            })
                            .collect();

                        Ok(offices)
                    } else {
                        Err(NetworkError::msg("Not authorized to access this workspace"))
                    }
                }
                _ => {
                    // If the root workspace doesn't exist yet, create it
                    if workspace_id == crate::WORKSPACE_ROOT_ID && self.tx_manager.is_admin(user_id) {
                        // Create the root workspace implicitly
                        let _ = self.with_write_transaction(|tx| {
                            let workspace = Workspace {
                                id: workspace_id.to_string(),
                                name: "Root Workspace".to_string(),
                                description: "Default root workspace".to_string(),
                                owner_id: user_id.to_string(),
                                members: vec![user_id.to_string()],
                                offices: vec![],
                                metadata: vec![],
                            };
                            tx.insert_domain(
                                workspace_id.to_string(),
                                Domain::Workspace { workspace },
                            )?;
                            Ok(())
                        });
                        // Return empty list of offices for newly created workspace
                        Ok(Vec::new())
                    } else {
                        Err(NetworkError::msg(format!(
                            "Workspace {} not found",
                            workspace_id
                        )))
                    }
                }
            }
        })
    }

    pub fn remove_office_from_workspace_inner(&self, user_id: &str, office_id: &str) -> Result<(), NetworkError> {
        // Use fixed workspace-root ID
        let workspace_id = crate::WORKSPACE_ROOT_ID.to_string();

        // Ensure user has permission
        if !self.check_entity_permission(user_id, &workspace_id, Permission::UpdateWorkspace)? {
            return Err(NetworkError::msg(
                "Permission denied: Cannot remove office from workspace",
            ));
        }

        self.with_write_transaction(move |tx| {
            // Get the workspace
            let domain = tx
                .get_domain(&workspace_id)
                .ok_or_else(|| NetworkError::msg("Workspace not found"))?;

            let mut workspace = match domain {
                Domain::Workspace { workspace } => workspace.clone(), // Clone to get owned value
                _ => return Err(NetworkError::msg("Domain is not a workspace")),
            };

            // Remove office from workspace
            workspace.offices.retain(|id| id != office_id);

            // Update workspace
            tx.insert_domain(workspace_id, Domain::Workspace { workspace })?;

            Ok(())
        })
    }

    pub fn add_office_to_workspace_inner(&self, user_id: &str, office_id: &&str) -> Result<(), NetworkError> {
        // Use fixed workspace-root ID
        let workspace_id = crate::WORKSPACE_ROOT_ID.to_string();

        // Ensure user has permission to update workspaces
        if !self.check_entity_permission(user_id, &workspace_id, Permission::UpdateWorkspace)? {
            return Err(NetworkError::msg(
                "Permission denied: Cannot add office to workspace",
            ));
        }

        self.with_write_transaction(|tx| {
            // Get the workspace
            let Some(Domain::Workspace { mut workspace }) = tx.get_domain(&workspace_id).cloned()
            else {
                return Err(NetworkError::msg("Workspace not found"));
            };

            // Get the office (we only need to verify it exists, since we're not modifying it anymore)
            if tx.get_domain(office_id).is_none() {
                return Err(NetworkError::msg(format!("Office {} not found", office_id)));
            }

            // Add the office to the workspace if not already present
            if !workspace.offices.contains(&office_id.to_string()) {
                workspace.offices.push(office_id.to_string());
            }

            // No need to update office's workspace_id - it's implied by the single workspace model

            // Update workspace entity
            tx.insert_domain(workspace_id, Domain::Workspace { workspace })?;
            Ok(())
        })
    }
}