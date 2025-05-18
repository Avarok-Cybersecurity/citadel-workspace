use citadel_sdk::prelude::*;
use citadel_workspace_types::structs::{Domain, Office, Room, Workspace};
use crate::handlers::domain::{permission_denied, DomainEntity, DomainOperations};
use crate::handlers::domain::server_ops::ServerDomainOps;
use crate::kernel::transaction::Transaction;

impl<R: Ratchet> ServerDomainOps<R> {
        pub(crate) fn create_domain_entity_inner<T>(&self, user_id: &str, parent_id: Option<&str>, name: &str, description: &str, mdx_content: Option<&str>) -> Result<T, NetworkError> where T: DomainEntity + Clone + 'static {
        self.with_write_transaction(|tx| {
            // Get parent domain if provided
            if let Some(parent_id) = parent_id {
                if !self.can_access_domain(user_id, parent_id)? {
                    return Err(permission_denied("Cannot access parent domain"));
                }
            }
    
            // Create entity with appropriate ID
            let entity_id = uuid::Uuid::new_v4().to_string();
            let entity = if std::any::type_name::<T>().contains("Office") {
                let office = Office {
                    id: entity_id.clone(),
                    name: name.to_string(),
                    description: description.to_string(),
                    owner_id: user_id.to_string(),
                    members: vec![user_id.to_string()], // Owner is automatically a member
                    rooms: Vec::new(),                  // Initialize with empty rooms
                    mdx_content: mdx_content.unwrap_or_default().to_string(), // Use provided MDX content or empty string
                    metadata: Vec::new(),
                };
    
                // Insert the office domain
                tx.insert_domain(
                    entity_id.clone(),
                    Domain::Office {
                        office: office.clone(),
                    },
                )?;
    
                // Convert back to T
                T::from_domain(Domain::Office { office })
                    .ok_or_else(|| permission_denied("Failed to convert to entity type"))?
            } else if std::any::type_name::<T>().contains("Room") {
                let parent = parent_id
                    .ok_or_else(|| permission_denied("Room requires a parent office ID"))?
                    .to_string();
    
                let room = Room {
                    id: entity_id.clone(),
                    name: name.to_string(),
                    description: description.to_string(),
                    office_id: parent,
                    owner_id: user_id.to_string(),
                    members: vec![user_id.to_string()], // Owner is automatically a member
                    mdx_content: mdx_content.unwrap_or_default().to_string(), // Use provided MDX content or empty string
                    metadata: Vec::new(),
                };
    
                // Insert the room domain
                tx.insert_domain(entity_id.clone(), Domain::Room { room: room.clone() })?;
    
                // Convert back to T
                T::from_domain(Domain::Room { room })
                    .ok_or_else(|| permission_denied("Failed to convert to entity type"))?
            } else if std::any::type_name::<T>().contains("Workspace") {
                let workspace = Workspace {
                    id: entity_id.clone(),
                    name: name.to_string(),
                    description: description.to_string(),
                    owner_id: user_id.to_string(),
                    members: vec![user_id.to_string()],
                    offices: Vec::new(),
                    metadata: Vec::new(),
                };
    
                // Insert the workspace domain
                tx.insert_domain(
                    entity_id.clone(),
                    Domain::Workspace {
                        workspace: workspace.clone(),
                    },
                )?;
    
                // Convert back to T
                T::from_domain(Domain::Workspace { workspace })
                    .ok_or_else(|| permission_denied("Failed to convert to entity type"))?
            } else {
                return Err(permission_denied("Unsupported entity type"));
            };
    
            Ok(entity)
        })
    }

    pub fn delete_domain_entity_inner<T>(&self, user_id: &str, entity_id: &str) -> Result<T, NetworkError>
    where
        T: DomainEntity + Clone + 'static
    {
        self.with_write_transaction(|tx| {
            // Check if user has permission to delete
            if !self.can_access_domain(user_id, entity_id)? {
                return Err(permission_denied("No permission to delete entity"));
            }

            // Get the domain first to return it later
            let domain = tx.get_domain(entity_id).cloned().ok_or_else(|| {
                permission_denied(format!("Entity {} not found", entity_id))
            })?;

            // Remove domain
            tx.remove_domain(entity_id)?;

            // Convert to the requested type
            T::from_domain(domain)
                .ok_or_else(|| permission_denied("Entity is not of the requested type"))
        })
    }

    pub fn list_domain_entities_inner<T>(&self, user_id: &str, parent_id: Option<&str>) -> Result<Result<Vec<T>, NetworkError>, NetworkError>
    where
        T: DomainEntity + Clone + 'static
    {
        // Get all domains of the specified type
        let all_domains = DomainOperations::with_read_transaction(self, |tx| {
            let domains = tx.get_all_domains();
            Ok(domains.values().cloned().collect::<Vec<Domain>>())
        })?;

        // Filter domains by type and parent ID
        let mut filtered_domains = Vec::new();
        for domain in all_domains {
            // Skip domains that don't match the requested type
            if T::from_domain(domain.clone()).is_none() {
                continue;
            }

            // Filter by parent ID if specified
            if let Some(parent_id) = parent_id {
                if let Domain::Room { room } = &domain {
                    if room.office_id != parent_id {
                        continue;
                    }
                }
            }

            // Check if user has access to this domain
            if let Ok(has_access) = ServerDomainOps::can_access_domain(self, user_id, domain.id()) {
                if has_access {
                    if let Some(entity) = T::from_domain(domain) {
                        filtered_domains.push(entity);
                    }
                }
            }
        }

        Ok(Ok(filtered_domains))
    }

    pub fn update_domain_entity_inner<T>(&self, user_id: &str, domain_id: &str, name: Option<&str>, description: Option<&str>, mdx_content: Option<&str>) -> Result<T, NetworkError>
    where
        T: DomainEntity + Clone + 'static
    {
        self.with_write_transaction(|tx| {
            // Check if user has permission to update
            if !self.can_access_domain(user_id, domain_id)? {
                return Err(permission_denied("No permission to update entity"));
            }

            // Get domain by ID
            let mut domain = tx.get_domain(domain_id).cloned().ok_or_else(|| {
                permission_denied(format!("Entity {} not found", domain_id))
            })?;

            // Update domain properties
            match &mut domain {
                Domain::Office { ref mut office } => {
                    if let Some(name) = name {
                        office.name = name.to_string();
                    }
                    if let Some(description) = description {
                        office.description = description.to_string();
                    }
                    if let Some(mdx) = mdx_content {
                        office.mdx_content = mdx.to_string();
                    }
                }
                Domain::Room { ref mut room } => {
                    if let Some(name) = name {
                        room.name = name.to_string();
                    }
                    if let Some(description) = description {
                        room.description = description.to_string();
                    }
                    if let Some(mdx) = mdx_content {
                        room.mdx_content = mdx.to_string();
                    }
                }
                Domain::Workspace { ref mut workspace } => {
                    if let Some(name) = name {
                        workspace.name = name.to_string();
                    }
                    if let Some(description) = description {
                        workspace.description = description.to_string();
                    }
                    // Workspaces don't have mdx_content, so ignore that parameter
                }
            }

            // Update domain
            tx.update_domain(domain_id, domain.clone())?;

            // Convert to the requested type
            T::from_domain(domain)
                .ok_or_else(|| permission_denied("Entity is not of the requested type"))
        })
    }
}