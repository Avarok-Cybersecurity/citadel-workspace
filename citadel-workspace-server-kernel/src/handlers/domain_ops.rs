use uuid::Uuid;

use citadel_sdk::prelude::{NetworkError, Ratchet};

use crate::structs::{Domain, User, UserRole, Office, Room};
use crate::handlers::transaction::TransactionManager;
use crate::kernel::WorkspaceServerKernel;

/// Domain entity trait for common operations
pub trait DomainEntity: Clone {
    /// Get the unique ID for this domain entity
    fn id(&self) -> &str;
    
    /// Get the name of this domain entity
    fn name(&self) -> &str;
    
    /// Get the description of this domain entity
    fn description(&self) -> &str;
    
    /// Get the owner ID of this domain entity
    fn owner_id(&self) -> &str;
    
    /// Get the list of members of this domain entity
    fn members(&self) -> &Vec<String>;
    
    /// Convert this entity to a Domain enum variant
    fn into_domain(self) -> Domain;
    
    /// Convert from a Domain to this entity type
    fn from_domain(domain: Domain) -> Option<Self> where Self: Sized;
}

/// Domain operation handlers
pub trait DomainOperations<R: Ratchet>: TransactionManager {
    /// Check if a user is an admin
    fn is_admin(&self, user_id: &str) -> bool;
    
    /// Check if a user is a member of a domain
    fn is_member_of_domain(&self, user_id: &str, domain_id: &str) -> Result<bool, NetworkError>;
    
    /// Check permissions for accessing a domain entity
    fn check_permission<T: DomainEntity + 'static>(
        &self,
        user_id: &str,
        entity_id: &str,
    ) -> Result<bool, NetworkError> {
        // Clone the domain ID to avoid lifetime issues
        let entity_id_owned = entity_id.to_string();
        
        // Get the domain from the transaction
        match self.with_read_transaction(|tx| {
            // Convert domain reference to owned value to avoid lifetime issues
            match tx.get_domain(&entity_id_owned) {
                Some(domain) => Ok(Some(domain.clone())),
                None => Ok(None),
            }
        })? {
            Some(domain) => match domain {
                Domain::Office { office } if std::any::TypeId::of::<T>() == std::any::TypeId::of::<Office>() => {
                    // Check if user is owner or admin
                    let is_admin = self.is_admin(user_id);
                    
                    Ok(office.owner_id == user_id || is_admin)
                },
                Domain::Room { room } if std::any::TypeId::of::<T>() == std::any::TypeId::of::<Room>() => {
                    // Check if user is owner or admin or office member
                    let is_admin = self.is_admin(user_id);
                    
                    // Check if user is a member of the parent office
                    let is_member = self.is_member_of_domain(user_id, &room.office_id)?;
                    
                    Ok(room.owner_id == user_id || is_admin || is_member)
                },
                _ => Err(NetworkError::Generic("Entity not found or type mismatch".into())),
            },
            None => Err(NetworkError::Generic("Entity not found".into())),
        }
    }
    
    /// Get a user by ID
    fn get_user(&self, user_id: &str) -> Option<User>;
    
    /// Get a domain by ID
    fn get_domain(&self, domain_id: &str) -> Option<Domain>;
    
    /// Add a user to a domain
    fn add_user_to_domain(
        &self,
        user_id: &str,
        domain_id: &str,
        target_user_id: &str,
    ) -> Result<(), NetworkError>;
    
    /// Remove a user from a domain
    fn remove_user_from_domain(
        &self,
        user_id: &str,
        domain_id: &str,
        target_user_id: &str,
    ) -> Result<(), NetworkError>;
    
    /// Create a new domain entity with permission checking
    fn create_entity<T: DomainEntity + 'static>(
        &self,
        user_id: &str,
        name: &str,
        description: &str,
        parent_id: Option<&str>,
        entity_factory: impl FnOnce(String) -> T,
        required_role: UserRole,
    ) -> Result<T, NetworkError> {
        // Check permissions - either admin or member of parent domain if applicable
        if let Some(parent_id) = parent_id {
            let is_admin = self.is_admin(user_id);
            let is_member = match self.is_member_of_domain(user_id, parent_id) {
                Ok(is_member) => is_member,
                Err(e) => return Err(e),
            };
            
            if !is_admin && !is_member {
                return Err(NetworkError::Generic("Permission denied: You must be a member of the parent domain".into()));
            }
        } else {
            // No parent domain - check for admin role
            let is_admin = self.is_admin(user_id);
            if !is_admin {
                return Err(NetworkError::Generic("Permission denied: Only admins can create top-level domains".into()));
            }
        }
        
        // Generate unique ID and create entity
        let entity_id = Uuid::new_v4().to_string();
        let entity = entity_factory(entity_id.clone());
        
        // Execute in a write transaction to add the domain
        self.with_write_transaction(|tx| {
            tx.insert(entity_id, entity.clone().into_domain());
            Ok(())
        })?;
        
        Ok(entity)
    }
    
    /// Get a domain entity by ID
    fn get_domain_entity<T: DomainEntity + From<Domain> + 'static>(
        &self,
        domain_id: &str,
    ) -> Option<T> {
        self.with_read_transaction(|tx| {
            if let Some(domain) = tx.get_domain(domain_id) {
                Ok(Some(T::from(domain.clone())))
            } else {
                Ok(None)
            }
        }).unwrap_or(None)
    }
    
    /// Delete a domain entity
    fn delete_domain_entity<T: DomainEntity + From<Domain> + 'static>(
        &self,
        user_id: &str,
        domain_id: &str,
    ) -> Result<T, NetworkError> {
        // Check permissions - must be admin or owner
        if !self.is_admin(user_id) {
            let domain_entity = self.get_domain_entity::<T>(domain_id)
                .ok_or_else(|| NetworkError::Generic("Domain not found".into()))?;
            
            if domain_entity.owner_id() != user_id {
                return Err(NetworkError::Generic("Permission denied: Must be admin or owner".into()));
            }
        }
        
        // Execute in a write transaction to remove the domain
        self.with_write_transaction(|tx| {
            if let Some(domain) = tx.get(domain_id).cloned() {
                tx.remove(domain_id)?;
                Ok(T::from(domain))
            } else {
                Err(NetworkError::Generic("Domain not found".into()))
            }
        })
    }
    
    /// Update a domain entity
    fn update_domain_entity<T: DomainEntity + 'static>(
        &self,
        user_id: &str,
        domain_id: &str,
        name: Option<&str>,
        description: Option<&str>,
    ) -> Result<(), NetworkError> {
        // Check permissions - admin or member check
        let has_permission = self.can_access_domain::<T>(user_id, domain_id)?;
        
        if !has_permission {
            return Err(NetworkError::Generic("Permission denied: You must be an owner or admin of the domain".into()));
        }
        
        // Execute in a write transaction to update the domain
        self.with_write_transaction(|tx| {
            if let Some(mut domain) = tx.get(domain_id).cloned() {
                // Update fields if provided
                if let Some(name) = name {
                    domain.update_name(name.to_string());
                }
                
                if let Some(description) = description {
                    domain.update_description(description.to_string());
                }
                
                tx.insert(domain_id.to_string(), domain);
                Ok(())
            } else {
                Err(NetworkError::Generic("Domain not found".into()))
            }
        })
    }
    
    /// List all domain entities of a specific type
    fn list_domain_entities<T: DomainEntity + From<Domain> + 'static>(
        &self,
        user_id: &str,
        parent_id: Option<&str>,
    ) -> Result<Vec<T>, NetworkError> {
        // Check permissions if parent_id is provided
        if let Some(parent_id) = parent_id {
            let is_admin = self.is_admin(user_id);
            let is_member = self.is_member_of_domain(user_id, parent_id);
            
            if !is_admin && is_member.is_err() {
                return Err(is_member.unwrap_err());
            } else if !is_admin && !is_member.unwrap_or(false) {
                return Err(NetworkError::Generic("Permission denied: You must be a member of the parent domain".into()));
            }
        }
        
        // Execute in a read transaction to list domains
        self.with_read_transaction(|tx| {
            let domains = tx.get_all_domains();
            
            // Filter domains by type using the From trait
            let entities: Vec<T> = domains
                .values()
                .filter_map(|domain| {
                    // Attempt to convert to the specific type
                    // If conversion fails (returns None), this domain is filtered out
                    let entity = T::from(domain.clone());
                    
                    // Filter by parent_id if provided
                    if let Some(parent_id) = parent_id {
                        // This assumes that the domain has a parent_id field that can be accessed
                        // For real implementation, you might need to check specific fields
                        // based on the domain type
                        if domain.parent_id() == parent_id {
                            Some(entity)
                        } else {
                            None
                        }
                    } else {
                        Some(entity)
                    }
                })
                .collect();
            
            Ok(entities)
        })
    }
    
    /// Check if a user has permissions to access a domain
    fn can_access_domain<T: DomainEntity + 'static>(
        &self,
        user_id: &str,
        domain_id: &str,
    ) -> Result<bool, NetworkError> {
        let domain_opt = self.with_read_transaction(|tx| {
            match tx.get_domain(domain_id) {
                Some(domain) => Ok(Some(domain.clone())),
                None => Ok(None),
            }
        })?;
        
        match domain_opt {
            Some(domain) => match domain {
                Domain::Office { office } if std::any::TypeId::of::<T>() == std::any::TypeId::of::<Office>() => {
                    // Check if user is owner or admin
                    let is_admin = self.is_admin(user_id);
                    
                    Ok(office.owner_id == user_id || is_admin)
                },
                Domain::Room { room } if std::any::TypeId::of::<T>() == std::any::TypeId::of::<Room>() => {
                    // Check if user is owner or admin or office member
                    let is_admin = self.is_admin(user_id);
                    
                    // Check if user is a member of the parent office
                    let is_member = self.is_member_of_domain(user_id, &room.office_id)?;
                    
                    Ok(room.owner_id == user_id || is_admin || is_member)
                },
                _ => Err(NetworkError::Generic("Entity not found or type mismatch".into())),
            },
            None => Err(NetworkError::Generic("Entity not found".into())),
        }
    }
}

// Implement DomainEntity for Office
impl DomainEntity for Office {
    fn id(&self) -> &str {
        &self.id
    }
    
    fn name(&self) -> &str {
        &self.name
    }
    
    fn description(&self) -> &str {
        &self.description
    }
    
    fn owner_id(&self) -> &str {
        &self.owner_id
    }
    
    fn members(&self) -> &Vec<String> {
        &self.members
    }
    
    fn into_domain(self) -> Domain {
        Domain::Office { office: self }
    }
    
    fn from_domain(domain: Domain) -> Option<Self> {
        match domain {
            Domain::Office { office } => Some(office),
            _ => None,
        }
    }
}

// Implement DomainEntity for Room
impl DomainEntity for Room {
    fn id(&self) -> &str {
        &self.id
    }
    
    fn name(&self) -> &str {
        &self.name
    }
    
    fn description(&self) -> &str {
        &self.description
    }
    
    fn owner_id(&self) -> &str {
        &self.owner_id
    }
    
    fn members(&self) -> &Vec<String> {
        &self.members
    }
    
    fn into_domain(self) -> Domain {
        Domain::Room { room: self }
    }
    
    fn from_domain(domain: Domain) -> Option<Self> {
        match domain {
            Domain::Room { room } => Some(room),
            _ => None,
        }
    }
}

/// Common domain operations trait implementation for the workspace kernel
#[allow(dead_code)]
impl<R: citadel_sdk::prelude::Ratchet> WorkspaceServerKernel<R> {
    /// Generic function to get a domain entity by ID with proper type checking
    pub fn get_domain_entity<T: DomainEntity + 'static>(&self, entity_id: &str) -> Option<T> {
        match self.with_read_transaction(|tx| {
            if let Some(domain) = tx.get_domain(entity_id) {
                if let Some(entity) = T::from_domain(domain.clone()) {
                    Ok(Some(entity))
                } else {
                    Ok(None)
                }
            } else {
                Ok(None)
            }
        }) {
            Ok(Some(entity)) => Some(entity),
            _ => None
        }
    }
    
    /// Create a new domain entity with permission checking
    pub fn create_domain_entity<T: DomainEntity + 'static>(
        &self,
        user_id: &str,
        name: &str,
        description: &str,
        parent_id: Option<&str>,
        entity_factory: impl FnOnce(String) -> T,
        required_role: UserRole,
    ) -> Result<T, NetworkError> {
        // Check permissions - either admin or member of parent domain if applicable
        if let Some(parent_id) = parent_id {
            let is_admin = self.is_admin(user_id);
            let is_member = match self.is_member_of_domain(user_id, parent_id) {
                Ok(is_member) => is_member,
                Err(e) => return Err(e),
            };
            
            if !is_admin && !is_member {
                return Err(NetworkError::Generic("Permission denied: You must be a member of the parent domain".into()));
            }
        }

        self.with_write_transaction(|tx| {
            // Generate a unique ID for the entity
            let id = uuid::Uuid::new_v4().to_string();
            
            // Create the entity using the factory function
            let entity = entity_factory(id.clone());
            
            // Convert to domain and insert
            let domain = entity.clone().into_domain();
            tx.insert(id, domain);
            
            Ok(entity)
        })
    }
    
    /// Delete a domain entity with parent entity access check
    pub fn delete_domain_entity_with_parent_check<T: DomainEntity + 'static>(
        &self,
        user_id: &str,
        entity_id: &str,
        parent_id: &str,
    ) -> Result<(), NetworkError> {
        // Check if user is admin or member of parent
        let is_admin = self.is_admin(user_id);
        let is_member = match self.is_member_of_domain(user_id, parent_id) {
            Ok(is_member) => is_member,
            Err(e) => return Err(e),
        };
        
        // Either admin or member of parent can delete
        if !is_admin && !is_member {
            return Err(NetworkError::Generic("Permission denied: You must be a member of the parent domain".into()));
        }
        
        // First check if entity exists and user has permission
        self.with_read_transaction(|tx| {
            if !tx.domain_exists(entity_id) {
                return Err(NetworkError::Generic("Entity not found".into()));
            }
            Ok(())
        })?;
        
        let has_permission = self.with_read_transaction(|tx| {
            match tx.get(entity_id) {
                Some(domain) => match domain {
                    Domain::Office { office } if std::any::TypeId::of::<T>() == std::any::TypeId::of::<Office>() => {
                        // Check if user is owner or admin
                        let is_admin = self.is_admin(user_id);
                        
                        Ok(office.owner_id == user_id || is_admin)
                    },
                    Domain::Room { room } if std::any::TypeId::of::<T>() == std::any::TypeId::of::<Room>() => {
                        // Check if user is owner or admin or office member
                        let is_admin = self.is_admin(user_id);
                        
                        // Check if user is a member of the parent office
                        let is_member = self.is_member_of_domain(user_id, &room.office_id)?;
                        
                        Ok(room.owner_id == user_id || is_admin || is_member)
                    },
                    _ => Err(NetworkError::Generic("Entity not found or type mismatch".into())),
                },
                None => Err(NetworkError::Generic("Entity not found".into())),
            }
        })?;
        
        if !has_permission {
            return Err(NetworkError::Generic("Permission denied: Only owner or admin can delete".into()));
        }
        
        // Execute in a write transaction to remove the entity
        self.with_write_transaction(|tx| {
            tx.remove(entity_id);
            Ok(())
        })
    }
    
    /// Delete a domain entity
    pub fn delete_domain_entity<T: DomainEntity + 'static>(
        &self,
        user_id: &str,
        entity_id: &str,
    ) -> Result<(), NetworkError> {
        // First check if entity exists and user has permission
        self.with_read_transaction(|tx| {
            if !tx.domain_exists(entity_id) {
                return Err(NetworkError::Generic("Entity not found".into()));
            }
            Ok(())
        })?;
        
        let has_permission = self.with_read_transaction(|tx| {
            match tx.get(entity_id) {
                Some(domain) => match domain {
                    Domain::Office { office } if std::any::TypeId::of::<T>() == std::any::TypeId::of::<Office>() => {
                        // Check if user is owner or admin
                        let is_admin = self.is_admin(user_id);
                        
                        Ok(office.owner_id == user_id || is_admin)
                    },
                    Domain::Room { room } if std::any::TypeId::of::<T>() == std::any::TypeId::of::<Room>() => {
                        // Check if user is owner or admin or office member
                        let is_admin = self.is_admin(user_id);
                        
                        // Check if user is a member of the parent office
                        let is_member = self.is_member_of_domain(user_id, &room.office_id)?;
                        
                        Ok(room.owner_id == user_id || is_admin || is_member)
                    },
                    _ => Err(NetworkError::Generic("Entity not found or type mismatch".into())),
                },
                None => Err(NetworkError::Generic("Entity not found".into())),
            }
        })?;
        
        if !has_permission {
            return Err(NetworkError::Generic("Permission denied: Only owner or admin can delete".into()));
        }
        
        // Execute in a write transaction to remove the entity
        self.with_write_transaction(|tx| {
            tx.remove(entity_id);
            Ok(())
        })
    }
    
    /// Update a domain entity with permission checking
    pub fn update_domain_entity<T: DomainEntity + 'static>(
        &self,
        user_id: &str,
        entity_id: &str,
        name: Option<&str>,
        description: Option<&str>,
    ) -> Result<(), NetworkError> {
        // Check permissions - admin or member check
        let has_permission = self.can_access_domain::<T>(user_id, entity_id)?;
        
        if !has_permission {
            return Err(NetworkError::Generic("Permission denied: You must be an owner or admin of the domain".into()));
        }
        
        // Execute in a write transaction to update the entity
        self.with_write_transaction(|tx| {
            if let Some(mut domain) = tx.get(entity_id).cloned() {
                // Update fields if provided
                if let Some(name) = name {
                    domain.update_name(name.to_string());
                }
                
                if let Some(description) = description {
                    domain.update_description(description.to_string());
                }
                
                tx.insert(entity_id.to_string(), domain);
                Ok(())
            } else {
                Err(NetworkError::Generic("Entity not found".into()))
            }
        })
    }
    
    /// List all entities of a specific type
    pub fn list_domain_entities<T: DomainEntity + 'static>(&self) -> Result<Vec<T>, NetworkError> {
        let result = self.with_read_transaction(|tx| {
            let domains = tx.get_all_domains();
            
            // Filter domains by type using the From trait
            let entities: Vec<T> = domains
                .values()
                .filter_map(|domain| {
                    // Attempt to convert to the specific type
                    // If conversion fails (returns None), this domain is filtered out
                    T::from_domain(domain.clone())
                })
                .collect();
            
            Ok(entities)
        });
        
        // Convert any transaction errors to NetworkError
        result
    }
    
    /// List all entities of a specific type by parent ID
    pub fn list_domain_entities_by_parent<T: DomainEntity + 'static>(&self, user_id: &str, parent_id: &str) -> Result<Vec<T>, NetworkError> {
        let result = self.with_read_transaction(|tx| {
            let domains = tx.get_all_domains();
            
            // Filter domains by type and parent ID
            let entities: Vec<T> = domains
                .values()
                .filter_map(|domain| {
                    // Attempt to convert to the specific type
                    let entity = T::from_domain(domain.clone());
                    if let Some(entity) = entity {
                        // Check if the parent ID matches (for rooms, this would be the office_id)
                        if let Some(entity_parent_id) = self.get_parent_id::<T>(domain) {
                            if entity_parent_id == parent_id {
                                return Some(entity);
                            }
                        }
                    }
                    None
                })
                .collect();
            
            Ok(entities)
        });
        
        // Convert any transaction errors to NetworkError
        result
    }
    
    /// Helper method to get parent ID for different entity types
    fn get_parent_id<T: DomainEntity + 'static>(&self, domain: &Domain) -> Option<String> {
        if std::any::TypeId::of::<T>() == std::any::TypeId::of::<Room>() {
            if let Domain::Room { room } = domain {
                return Some(room.office_id.clone());
            }
        }
        // For other entity types, we might need to implement specific logic
        None
    }
}
