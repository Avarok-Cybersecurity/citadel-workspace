use citadel_sdk::prelude::{NetworkError, NodeRemote, NodeResult, Ratchet};
use citadel_logging::debug;

use std::collections::HashMap;
use std::sync::{Arc, RwLock};

use crate::handlers::domain_ops::{DomainEntity, DomainOperations};
use crate::handlers::transaction::{ReadTransaction, TransactionManager, WriteTransaction};
use crate::commands::{WorkspaceCommand, WorkspaceResponse, UpdateOperation};
use crate::structs::{Domain, Office, Room, User, UserRole, WorkspaceRoles, Permission};

/// Server kernel implementation
#[allow(dead_code)]
pub struct WorkspaceServerKernel<R: Ratchet> {
    pub roles: Arc<RwLock<WorkspaceRoles>>,
    pub users: Arc<RwLock<HashMap<String, User>>>,
    pub domains: Arc<RwLock<HashMap<String, Domain>>>,
    pub node_remote: Option<NodeRemote<R>>,
}

impl<R: Ratchet> Default for WorkspaceServerKernel<R> {
    fn default() -> Self {
        // Initialize with a default admin user
        let mut users = HashMap::new();
        let permissions = HashMap::new();
        
        users.insert(
            "admin".to_string(),
            User {
                id: "admin".to_string(),
                name: "Administrator".to_string(),
                role: UserRole::Admin,
                permissions,
            },
        );

        WorkspaceServerKernel {
            roles: Arc::new(RwLock::new(WorkspaceRoles::new())),
            users: Arc::new(RwLock::new(users)),
            domains: Arc::new(RwLock::new(HashMap::new())),
            node_remote: None,
        }
    }
}

#[allow(dead_code)]
impl<R: Ratchet> WorkspaceServerKernel<R> {
    // Helper methods for permission checking
    pub fn check_permission(&self, user_id: &str, domain_id: Option<&str>, required_role: UserRole) -> Result<(), NetworkError> {
        let users = self.users.read().unwrap();

        if let Some(user) = users.get(user_id) {
            if user.role == UserRole::Admin || user.role >= required_role {
                // Check domain-specific permissions if a domain is specified
                if let Some(domain_id) = domain_id {
                    match self.is_member_of_domain(user_id, domain_id) {
                        Ok(is_member) if is_member => return Ok(()),
                        Ok(_) => {},
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

        Err(NetworkError::msg("Permission denied: Not a member of the domain"))
    }
    
    pub fn is_admin(&self, user_id: &str) -> bool {
        let users = self.users.read().unwrap();
        
        if let Some(user) = users.get(user_id) {
            user.role == UserRole::Admin
        } else {
            false
        }
    }

    // Helper method to check if a user is a member of a domain (office or room)
    pub fn is_member_of_domain(&self, user_id: &str, domain_id: &str) -> Result<bool, NetworkError> {
        let domains = self.domains.read().unwrap();
        
        match domains.get(domain_id) {
            Some(domain) => match domain {
                Domain::Office { office } => Ok(office.members.contains(&user_id.to_string())),
                Domain::Room { room } => Ok(room.members.contains(&user_id.to_string())),
            },
            None => Err(NetworkError::msg(format!("Domain {} not found", domain_id))),
        }
    }

    // Process a command and return a response
    pub fn process_command(
        &self,
        user_id: &str,
        command: WorkspaceCommand,
    ) -> Result<WorkspaceResponse, NetworkError> {
        match command {
            // Office commands
            WorkspaceCommand::CreateOffice { name, description } => {
                match self.create_office(user_id, &name, &description) {
                    Ok(office) => Ok(WorkspaceResponse::Office(office)),
                    Err(e) => Ok(WorkspaceResponse::Error(format!(
                        "Failed to create office: {}",
                        e
                    ))),
                }
            }
            WorkspaceCommand::GetOffice { office_id } => match self.get_office(&office_id) {
                Some(office) => Ok(WorkspaceResponse::Office(office)),
                None => Ok(WorkspaceResponse::Error("Office not found".to_string())),
            },
            WorkspaceCommand::DeleteOffice { office_id } => {
                match self.delete_office(user_id, &office_id) {
                    Ok(_) => Ok(WorkspaceResponse::Success),
                    Err(e) => Ok(WorkspaceResponse::Error(format!(
                        "Failed to delete office: {}",
                        e
                    ))),
                }
            }
            WorkspaceCommand::UpdateOffice {
                office_id,
                name,
                description,
            } => match self.update_office(user_id, &office_id, name.as_deref(), description.as_deref()) {
                Ok(()) => {
                    // After updating, get the latest office data to return
                    if let Some(updated_office) = self.get_office(&office_id) {
                        Ok(WorkspaceResponse::Office(updated_office))
                    } else {
                        Ok(WorkspaceResponse::Error("Office not found after update".into()))
                    }
                }
                Err(e) => Ok(WorkspaceResponse::Error(format!(
                    "Failed to update office: {}",
                    e
                ))),
            },

            // Room commands
            WorkspaceCommand::CreateRoom {
                office_id,
                name,
                description,
            } => match self.create_room(user_id, &office_id, &name, &description) {
                Ok(room) => Ok(WorkspaceResponse::Room(room)),
                Err(e) => Ok(WorkspaceResponse::Error(format!(
                    "Failed to create room: {}",
                    e
                ))),
            },
            WorkspaceCommand::GetRoom { room_id } => match self.get_room(&room_id) {
                Some(room) => Ok(WorkspaceResponse::Room(room)),
                None => Ok(WorkspaceResponse::Error("Room not found".to_string())),
            },
            WorkspaceCommand::DeleteRoom { room_id } => match self.delete_room(user_id, &room_id) {
                Ok(_) => Ok(WorkspaceResponse::Success),
                Err(e) => Ok(WorkspaceResponse::Error(format!(
                    "Failed to delete room: {}",
                    e
                ))),
            }
            WorkspaceCommand::UpdateRoom {
                room_id,
                name,
                description,
            } => match self.update_room(user_id, &room_id, name.as_deref(), description.as_deref()) {
                Ok(()) => {
                    // After updating, get the latest room data to return
                    if let Some(updated_room) = self.get_room(&room_id) {
                        Ok(WorkspaceResponse::Room(updated_room))
                    } else {
                        Ok(WorkspaceResponse::Error("Room not found after update".into()))
                    }
                }
                Err(e) => Ok(WorkspaceResponse::Error(format!(
                    "Failed to update room: {}",
                    e
                ))),
            },

            // Member commands
            WorkspaceCommand::AddMember {
                user_id: member_id,
                office_id,
                room_id,
                role,
            } => match self.add_member(user_id, &member_id, office_id.as_deref(), room_id.as_deref(), role) {
                Ok(_) => Ok(WorkspaceResponse::Success),
                Err(e) => Ok(WorkspaceResponse::Error(format!(
                    "Failed to add member: {}",
                    e
                ))),
            },
            WorkspaceCommand::GetMember { user_id: member_id } => {
                match self.get_member(&member_id) {
                    Some(member) => Ok(WorkspaceResponse::Member(member)),
                    None => Ok(WorkspaceResponse::Error("Member not found".to_string())),
                }
            },
            WorkspaceCommand::UpdateMemberRole {
                user_id: member_id,
                role,
            } => match self.update_member_role(user_id, &member_id, role) {
                Ok(member) => Ok(WorkspaceResponse::Member(member)),
                Err(e) => Ok(WorkspaceResponse::Error(format!(
                    "Failed to update member role: {}",
                    e
                ))),
            },
            WorkspaceCommand::UpdateMemberPermissions {
                user_id: member_id,
                domain_id,
                permissions,
                operation,
            } => {
                // Update permissions for a member
                match self.update_permissions_for_member(user_id, &member_id, &domain_id, &permissions, operation) {
                    Ok(_) => Ok(WorkspaceResponse::Success),
                    Err(e) => Ok(WorkspaceResponse::Error(format!(
                        "Failed to update member permissions: {}",
                        e
                    ))),
                }
            },
            WorkspaceCommand::RemoveMember {
                user_id: member_id,
                office_id,
                room_id,
            } => match self.remove_member(user_id, &member_id, office_id.as_deref(), room_id.as_deref()) {
                Ok(_) => Ok(WorkspaceResponse::Success),
                Err(e) => Ok(WorkspaceResponse::Error(format!(
                    "Failed to remove member: {}",
                    e
                ))),
            },

            // Query commands
            WorkspaceCommand::ListOffices => {
                let offices = self.list_offices()?;
                Ok(WorkspaceResponse::Offices(offices))
            }
            WorkspaceCommand::ListRooms { office_id } => {
                let rooms = self.list_rooms(user_id, &office_id)?;
                Ok(WorkspaceResponse::Rooms(rooms))
            }
            WorkspaceCommand::ListMembers { office_id, room_id } => {
                match (office_id, room_id) {
                    (Some(office_id), None) => {
                        // List members in office
                        let members = match self.list_members_in_domain(user_id, &office_id) {
                            Ok(members) => members,
                            Err(e) => return Ok(WorkspaceResponse::Error(format!("Failed to list members: {}", e))),
                        };
                        Ok(WorkspaceResponse::Members(members))
                    }
                    (None, Some(room_id)) => {
                        // List members in room
                        let members = match self.list_members_in_domain(user_id, &room_id) {
                            Ok(members) => members,
                            Err(e) => return Ok(WorkspaceResponse::Error(format!("Failed to list members: {}", e))),
                        };
                        Ok(WorkspaceResponse::Members(members))
                    }
                    _ => Ok(WorkspaceResponse::Error(
                        "Must specify either office_id or room_id".to_string()
                    )),
                }
            }
        }
    }

    // Update a member's permissions for a domain (kernel implementation)
    pub fn update_permissions_for_member(
        &self,
        user_id: &str,
        member_id: &str,
        domain_id: &str,
        permissions: &[Permission],
        operation: UpdateOperation,
    ) -> Result<(), NetworkError> {
        // Check if the requesting user is an admin or the owner of the domain
        if !self.is_admin(user_id) {
            let domains = self.domains.read().unwrap();
            match domains.get(domain_id) {
                Some(Domain::Office { office }) => {
                    if office.owner_id != user_id {
                        return Err(NetworkError::msg(
                            "Permission denied: You must be an admin or the domain owner to update permissions",
                        ));
                    }
                },
                Some(Domain::Room { room }) => {
                    if room.owner_id != user_id {
                        return Err(NetworkError::msg(
                            "Permission denied: You must be an admin or the domain owner to update permissions",
                        ));
                    }
                },
                _ => return Err(NetworkError::msg("Domain not found")),
            }
        }

        // Get the user and update their permissions
        let mut users = self.users.write().unwrap();
        let user = users.get_mut(member_id).ok_or_else(|| NetworkError::msg("User not found"))?;

        // Initialize domain permissions if they don't exist
        if !user.permissions.contains_key(domain_id) {
            user.permissions.insert(domain_id.to_string(), std::collections::HashSet::new());
        }

        // Get the permission set for this domain
        let domain_permissions = user.permissions.get_mut(domain_id).unwrap();

        // Apply the permission operation
        match operation {
            UpdateOperation::Add => {
                // Add all permissions to the set
                for permission in permissions {
                    domain_permissions.insert(permission.clone());
                }
            },
            UpdateOperation::Remove => {
                // Remove specified permissions from the set
                for permission in permissions {
                    domain_permissions.remove(permission);
                }
            },
            UpdateOperation::Set => {
                // Replace existing permissions with the new set
                domain_permissions.clear();
                for permission in permissions {
                    domain_permissions.insert(permission.clone());
                }
            },
        }

        Ok(())
    }

    // Helper method to list members in a specific domain (office or room)
    fn list_members_in_domain(&self, user_id: &str, domain_id: &str) -> Result<Vec<User>, NetworkError> {
        // Check permission
        self.check_permission(user_id, Some(domain_id), UserRole::Member)?;

        // Get domain
        let domains = self.domains.read().unwrap();
        let domain = domains.get(domain_id).ok_or_else(|| NetworkError::msg(format!("Domain {} not found", domain_id)))?;

        // Get members from domain
        let member_ids = domain.members().clone();
        let users = self.users.read().unwrap();
        
        // Collect users
        let mut members = Vec::new();
        for id in member_ids {
            if let Some(user) = users.get(&id) {
                members.push(user.clone());
            }
        }
        
        Ok(members)
    }
}

// Transaction manager implementation
impl<R: Ratchet> TransactionManager for WorkspaceServerKernel<R> {
    fn begin_read_transaction(&self) -> Result<ReadTransaction, NetworkError> {
        match self.domains.read() {
            Ok(guard) => Ok(ReadTransaction::new(guard)),
            Err(_) => Err(NetworkError::msg("Failed to acquire read lock for transaction"))
        }
    }
    
    fn begin_write_transaction(&self) -> Result<WriteTransaction, NetworkError> {
        match self.domains.write() {
            Ok(guard) => Ok(WriteTransaction::new(guard)),
            Err(_) => Err(NetworkError::msg("Failed to acquire write lock for transaction"))
        }
    }
    
    fn with_read_transaction<F, T>(&self, f: F) -> Result<T, NetworkError>
    where
        F: FnOnce(ReadTransaction) -> Result<T, NetworkError>
    {
        let tx = self.begin_read_transaction()?;
        f(tx)
    }
    
    fn with_write_transaction<F, T>(&self, f: F) -> Result<T, NetworkError>
    where
        F: FnOnce(&mut WriteTransaction) -> Result<T, NetworkError>
    {
        let mut tx = self.begin_write_transaction()?;
        match f(&mut tx) {
            Ok(result) => {
                tx.commit();
                Ok(result)
            },
            Err(e) => {
                tx.rollback();
                Err(e)
            }
        }
    }
}

#[async_trait::async_trait]
impl<R: Ratchet + Send + Sync + 'static> citadel_sdk::prelude::NetKernel<R> for WorkspaceServerKernel<R> {
    async fn on_start<'a>(&'a self) -> Result<(), NetworkError> {
        debug!("NetKernel started");
        Ok(())
    }

    async fn on_node_event_received<'a>(&'a self, event: NodeResult<R>) -> Result<(), NetworkError> {
        self.process_node_event(event).await
    }

    async fn on_stop<'a>(&'a mut self) -> Result<(), NetworkError> {
        debug!("NetKernel stopped");
        Ok(())
    }

    fn load_remote(&mut self, server_remote: NodeRemote<R>) -> Result<(), NetworkError> {
        self.node_remote = Some(server_remote);
        Ok(())
    }
}

impl<R: Ratchet> WorkspaceServerKernel<R> {
    // Process node events received from the network
    async fn process_node_event(&self, _event: NodeResult<R>) -> Result<(), NetworkError> {
        // Here you would handle the event based on its type and content
        // For now we just return Ok as a placeholder
        Ok(())
    }
    
    // Helper method to properly update domain members
    fn update_domain_members(&self, domain_id: &str, user_id: &str, action: MemberAction) -> Result<(), NetworkError> {
        let mut domains = self.domains.write().unwrap();
        let domain = domains.get_mut(domain_id);
        
        match domain {
            Some(domain) => match action {
                MemberAction::Add => {
                    // Implement proper member addition logic here based on domain implementation
                    match domain {
                        Domain::Office { office } => {
                            let mut members = office.members.clone();
                            if !members.contains(&user_id.to_string()) {
                                members.push(user_id.to_string());
                                office.members = members;
                            }
                        },
                        Domain::Room { room } => {
                            let mut members = room.members.clone();
                            if !members.contains(&user_id.to_string()) {
                                members.push(user_id.to_string());
                                room.members = members;
                            }
                        },
                    }
                },
                MemberAction::Remove => {
                    // Implement proper member removal logic here
                    match domain {
                        Domain::Office { office } => {
                            let mut members = office.members.clone();
                            members.retain(|id| id != user_id);
                            office.members = members;
                        },
                        Domain::Room { room } => {
                            let mut members = room.members.clone();
                            members.retain(|id| id != user_id);
                            room.members = members;
                        },
                    }
                }
            },
            None => return Err(NetworkError::msg(format!("Domain {} not found", domain_id))),
        }
        
        Ok(())
    }

    fn delete_entity<T: DomainEntity + 'static>(
        &self,
        user_id: &str,
        entity_id: &str,
    ) -> Result<(), NetworkError> {
        // First check if entity exists and user has permission
        let has_permission = self.can_access_domain::<T>(user_id, entity_id)?;
        
        if !has_permission {
            return Err(NetworkError::Generic("Permission denied: Only owner or admin can delete".into()));
        }
        
        // Execute in a write transaction to remove the entity
        self.with_write_transaction(|tx| {
            if tx.get_domain(entity_id).is_some() {
                tx.remove(entity_id)?;
                Ok(())
            } else {
                Err(NetworkError::Generic("Entity not found".into()))
            }
        })
    }
}

// Helper enum for member operations
enum MemberAction {
    Add,
    Remove,
}

impl<R: Ratchet> DomainOperations<R> for WorkspaceServerKernel<R> {
    fn is_admin(&self, user_id: &str) -> bool {
        let users = self.users.read().unwrap();
        let user = users.get(user_id);

        match user {
            Some(user) => user.role == UserRole::Admin,
            None => false,
        }
    }

    fn is_member_of_domain(&self, user_id: &str, domain_id: &str) -> Result<bool, NetworkError> {
        self.with_read_transaction(|tx| {
            // Check if user exists
            let users = self.users.read().unwrap();
            if users.get(user_id).is_none() {
                return Ok(false);
            }
            
            // Check if domain exists and user is a member
            match tx.get_domain(domain_id) {
                Some(domain) => {
                    match domain {
                        Domain::Office { office } => {
                            // Convert &str to String for comparison
                            let user_id_string = user_id.to_string();
                            Ok(office.members.contains(&user_id_string) || office.owner_id == user_id)
                        },
                        Domain::Room { room } => {
                            // Convert &str to String for comparison
                            let user_id_string = user_id.to_string();
                            Ok(room.members.contains(&user_id_string) || room.owner_id == user_id)
                        },
                    }
                },
                None => Ok(false),
            }
        })
    }

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

    fn get_user(&self, user_id: &str) -> Option<User> {
        let users = self.users.read().unwrap();
        users.get(user_id).cloned()
    }

    fn get_domain(&self, domain_id: &str) -> Option<Domain> {
        let domains = self.domains.read().unwrap();
        domains.get(domain_id).cloned()
    }

    fn add_user_to_domain(
        &self,
        user_id: &str,
        domain_id: &str,
        target_user_id: &str,
    ) -> Result<(), NetworkError> {
        // First check if the user has permission
        self.check_permission(user_id, Some(domain_id), UserRole::Admin)?;
        
        // Check if target user exists
        let users = self.users.read().unwrap();
        if !users.contains_key(target_user_id) {
            return Err(NetworkError::msg(format!("Target user {} not found", target_user_id)));
        }
        
        // Add user to domain
        self.update_domain_members(domain_id, target_user_id, MemberAction::Add)?;
        
        Ok(())
    }

    fn remove_user_from_domain(
        &self,
        user_id: &str,
        domain_id: &str,
        target_user_id: &str,
    ) -> Result<(), NetworkError> {
        // Check if the user has permission to remove members
        self.check_permission(user_id, Some(domain_id), UserRole::Admin)?;

        // Remove target user from domain
        self.update_domain_members(domain_id, target_user_id, MemberAction::Remove)?;
        
        Ok(())
    }
}