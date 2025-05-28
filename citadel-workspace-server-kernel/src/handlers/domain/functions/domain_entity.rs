use crate::handlers::domain::server_ops::DomainServerOperations;
use crate::handlers::domain::{permission_denied, DomainEntity, DomainOperations};
use citadel_sdk::prelude::*;
use citadel_workspace_types::structs::{Domain};

impl<R: Ratchet> DomainServerOperations<R> {
    pub fn delete_domain_entity_inner<T>(
        &self,
        user_id: &str,
        entity_id: &str,
    ) -> Result<T, NetworkError>
    where
        T: DomainEntity + Clone + 'static,
    {
        self.with_write_transaction(|tx| {
            // Check if user has permission to delete
            if !self.can_access_domain(tx, user_id, entity_id)? {
                return Err(permission_denied("No permission to delete entity"));
            }

            // Get the domain first to return it later
            let domain = tx
                .get_domain(entity_id)
                .cloned()
                .ok_or_else(|| permission_denied(format!("Entity {} not found", entity_id)))?;

            // Remove domain
            tx.remove_domain(entity_id)?;

            // Convert to the requested type
            T::from_domain(domain)
                .ok_or_else(|| permission_denied("Entity is not of the requested type"))
        })
    }

    pub fn list_domain_entities_inner<T>(
        &self,
        user_id: &str,
        parent_id: Option<&str>,
    ) -> Result<Vec<T>, NetworkError>
    where
        T: DomainEntity + Clone + 'static,
    {
        self.with_read_transaction(|tx| {
            let all_domains_vec = tx.get_all_domains()?; // This is Vec<(String, Domain)>
            let mut filtered_entities = Vec::new();

            for (_domain_id, domain_val) in all_domains_vec {
                // domain_val is Domain (owned)
                // Skip domains that don't match the requested type T
                // T::from_domain expects an owned Domain, so we clone it here.
                // If T::from_domain could take &Domain, we wouldn't need this clone.
                if T::from_domain(domain_val.clone()).is_none() {
                    continue;
                }

                // Filter by parent ID if specified
                if let Some(p_id) = parent_id {
                    match &domain_val {
                        // Match against a reference to the owned domain_val
                        Domain::Room { room } => {
                            if room.office_id != p_id {
                                continue;
                            }
                        }
                        // Add cases for Office with workspace_id as parent_id if T can be Office
                        // Domain::Office { office } => { ... }
                        _ => {}
                    }
                }

                // Check if user has access to this domain
                // domain_val.id() returns &str, which is fine for can_access_domain
                if self.can_access_domain(tx, user_id, domain_val.id())? {
                    // T::from_domain takes an owned Domain. Since domain_val is already owned and moved in the loop,
                    // and we cloned it for the check above, we can pass the original domain_val here.
                    // If the first T::from_domain call consumed it, this logic would need adjustment.
                    // Assuming T::from_domain(domain_val.clone()) was just for the check, and now we use the original.
                    // However, to be safe and clear, if T::from_domain consumes, we should use the already cloned value or re-clone.
                    // Let's assume the first clone was for the check, and we need to pass an owned value again.
                    // If T::from_domain does not consume, then the .clone() here is redundant if the first one was sufficient.
                    // Given the previous structure, it seems T::from_domain is called twice. Let's stick to cloning for safety.
                    if let Some(entity) = T::from_domain(domain_val) {
                        // Pass the owned domain_val (moved from the vec)
                        filtered_entities.push(entity);
                    }
                }
            }
            Ok(filtered_entities)
        })
    }

    pub fn update_domain_entity_inner<T>(
        &self,
        user_id: &str,
        domain_id: &str,
        name: Option<&str>,
        description: Option<&str>,
        mdx_content: Option<&str>,
    ) -> Result<T, NetworkError>
    where
        T: DomainEntity + Clone + 'static,
    {
        self.with_write_transaction(|tx| {
            // Check if user has permission to update
            if !self.can_access_domain(tx, user_id, domain_id)? {
                return Err(permission_denied("No permission to update entity"));
            }

            // Get domain by ID
            let mut domain = tx
                .get_domain(domain_id)
                .cloned()
                .ok_or_else(|| permission_denied(format!("Entity {} not found", domain_id)))?;

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
