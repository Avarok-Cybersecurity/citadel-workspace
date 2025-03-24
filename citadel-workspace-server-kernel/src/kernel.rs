use citadel_logging::{debug, info};
use citadel_sdk::prelude::{NetworkError, NodeRemote, NodeResult, Ratchet};

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, RwLock};

use crate::commands::{UpdateOperation, WorkspaceCommand, WorkspaceResponse};
use crate::handlers::domain_ops::{DomainEntity, DomainOperations};
use crate::handlers::transaction::{ReadTransaction, Transaction, WriteTransaction};
use crate::structs::{Domain, Office, Permission, Room, User, UserRole, WorkspaceRoles};

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
    pub fn check_permission(
        &self,
        user_id: &str,
        domain_id: Option<&str>,
        required_role: UserRole,
    ) -> Result<(), NetworkError> {
        let users = self.users.read().unwrap();

        if let Some(user) = users.get(user_id) {
            if user.role == UserRole::Admin || user.role >= required_role {
                // Check domain-specific permissions if a domain is specified
                if let Some(domain_id) = domain_id {
                    match self.is_member_of_domain(user_id, domain_id) {
                        Ok(is_member) if is_member => return Ok(()),
                        Ok(_) => {}
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

        Err(NetworkError::msg(
            "Permission denied: Not a member of the domain",
        ))
    }

    pub fn is_admin(&self, user_id: &str) -> bool {
        let roles = self.roles.read().unwrap();
        match roles.roles.get(user_id) {
            Some(role) if *role == UserRole::Admin => {
                debug!(target: "citadel", "User {} has admin role", user_id);
                true
            }
            _ => false,
        }
    }

    // Helper method to check if a user is a member of a domain (office or room)
    pub fn is_member_of_domain(
        &self,
        user_id: &str,
        domain_id: &str,
    ) -> Result<bool, NetworkError> {
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
            WorkspaceCommand::GetOffice { office_id } => match self.get_office(user_id, &office_id)
            {
                Ok(office) => Ok(WorkspaceResponse::Office(office)),
                Err(e) => Ok(WorkspaceResponse::Error(format!(
                    "Failed to get office: {}",
                    e
                ))),
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
            } => match self.update_office(
                user_id,
                &office_id,
                name.as_deref(),
                description.as_deref(),
            ) {
                Ok(updated_office) => Ok(WorkspaceResponse::Office(updated_office)),
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
            WorkspaceCommand::GetRoom { room_id } => match self.get_room(user_id, &room_id) {
                Ok(room) => Ok(WorkspaceResponse::Room(room)),
                Err(e) => Ok(WorkspaceResponse::Error(format!(
                    "Failed to get room: {}",
                    e
                ))),
            },
            WorkspaceCommand::DeleteRoom { room_id } => match self.delete_room(user_id, &room_id) {
                Ok(_) => Ok(WorkspaceResponse::Success),
                Err(e) => Ok(WorkspaceResponse::Error(format!(
                    "Failed to delete room: {}",
                    e
                ))),
            },
            WorkspaceCommand::UpdateRoom {
                room_id,
                name,
                description,
            } => match self.update_room(user_id, &room_id, name.as_deref(), description.as_deref())
            {
                Ok(updated_room) => Ok(WorkspaceResponse::Room(updated_room)),
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
            } => match self.add_member(
                user_id,
                &member_id,
                office_id.as_deref(),
                room_id.as_deref(),
                role,
            ) {
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
            }
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
                match self.update_permissions_for_member(
                    user_id,
                    &member_id,
                    &domain_id,
                    &permissions,
                    operation,
                ) {
                    Ok(_) => Ok(WorkspaceResponse::Success),
                    Err(e) => Ok(WorkspaceResponse::Error(format!(
                        "Failed to update member permissions: {}",
                        e
                    ))),
                }
            }
            WorkspaceCommand::RemoveMember {
                user_id: member_id,
                office_id,
                room_id,
            } => match self.remove_member(
                user_id,
                &member_id,
                office_id.as_deref(),
                room_id.as_deref(),
            ) {
                Ok(_) => Ok(WorkspaceResponse::Success),
                Err(e) => Ok(WorkspaceResponse::Error(format!(
                    "Failed to remove member: {}",
                    e
                ))),
            },

            // Query commands
            WorkspaceCommand::ListOffices => {
                let offices = self.list_offices(user_id, None)?;
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
                            Err(e) => {
                                return Ok(WorkspaceResponse::Error(format!(
                                    "Failed to list members: {}",
                                    e
                                )))
                            }
                        };
                        Ok(WorkspaceResponse::Members(members))
                    }
                    (None, Some(room_id)) => {
                        // List members in room
                        let members = match self.list_members_in_domain(user_id, &room_id) {
                            Ok(members) => members,
                            Err(e) => {
                                return Ok(WorkspaceResponse::Error(format!(
                                    "Failed to list members: {}",
                                    e
                                )))
                            }
                        };
                        Ok(WorkspaceResponse::Members(members))
                    }
                    _ => Ok(WorkspaceResponse::Error(
                        "Must specify either office_id or room_id".to_string(),
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
                }
                Some(Domain::Room { room }) => {
                    if room.owner_id != user_id {
                        return Err(NetworkError::msg(
                            "Permission denied: You must be an admin or the domain owner to update permissions",
                        ));
                    }
                }
                _ => return Err(NetworkError::msg("Domain not found")),
            }
        }

        // Get the user and update their permissions
        let mut users = self.users.write().unwrap();
        let user = users
            .get_mut(member_id)
            .ok_or_else(|| NetworkError::msg("User not found"))?;

        // Initialize domain permissions if they don't exist
        if !user.permissions.contains_key(domain_id) {
            user.permissions
                .insert(domain_id.to_string(), HashSet::new());
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
            }
            UpdateOperation::Remove => {
                // Remove specified permissions from the set
                for permission in permissions {
                    domain_permissions.remove(permission);
                }
            }
            UpdateOperation::Set => {
                // Replace existing permissions with the new set
                domain_permissions.clear();
                for permission in permissions {
                    domain_permissions.insert(permission.clone());
                }
            }
        }

        debug!(target: "citadel", "Audit log: User {} updated permissions for user {} in domain {}", user_id, member_id, domain_id);
        Ok(())
    }

    // Helper method to list members in a specific domain (office or room)
    fn list_members_in_domain(
        &self,
        user_id: &str,
        domain_id: &str,
    ) -> Result<Vec<User>, NetworkError> {
        // Check permission
        self.check_permission(user_id, Some(domain_id), UserRole::Member)?;

        // Get domain
        let domains = self.domains.read().unwrap();
        let domain = domains
            .get(domain_id)
            .ok_or_else(|| NetworkError::msg(format!("Domain {} not found", domain_id)))?;

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

    pub fn begin_read_transaction(&self) -> Result<ReadTransaction, NetworkError> {
        match self.domains.read() {
            Ok(guard) => Ok(ReadTransaction::new(guard)),
            Err(_) => Err(NetworkError::msg(
                "Failed to acquire read lock for transaction",
            )),
        }
    }

    pub fn begin_write_transaction(&self) -> Result<WriteTransaction, NetworkError> {
        match self.domains.write() {
            Ok(guard) => Ok(WriteTransaction::new(guard)),
            Err(_) => Err(NetworkError::msg(
                "Failed to acquire write lock for transaction",
            )),
        }
    }

    pub fn with_read_transaction<F, T>(&self, f: F) -> Result<T, NetworkError>
    where
        F: FnOnce(&dyn Transaction) -> Result<T, NetworkError>,
    {
        let tx = self.begin_read_transaction()?;
        let result = f(&tx);
        // Read transaction auto-drops
        result
    }

    pub fn with_write_transaction<F, T>(&self, f: F) -> Result<T, NetworkError>
    where
        F: FnOnce(&mut dyn Transaction) -> Result<T, NetworkError>,
    {
        let mut tx = self.begin_write_transaction()?;
        match f(&mut tx) {
            Ok(result) => {
                tx.commit()?;
                Ok(result)
            }
            Err(e) => {
                // Automatically roll back on error
                tx.rollback();
                Err(e)
            }
        }
    }
}

#[async_trait::async_trait]
impl<R: Ratchet + Send + Sync + 'static> citadel_sdk::prelude::NetKernel<R>
    for WorkspaceServerKernel<R>
{
    async fn on_start<'a>(&'a self) -> Result<(), NetworkError> {
        debug!("NetKernel started");
        Ok(())
    }

    async fn on_node_event_received<'a>(
        &'a self,
        event: NodeResult<R>,
    ) -> Result<(), NetworkError> {
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
        // This is a placeholder implementation
        Ok(())
    }

    // Helper method to properly update domain members
    fn update_domain_members(
        &self,
        domain_id: &str,
        user_id: &str,
        action: MemberAction,
    ) -> Result<(), NetworkError> {
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
                        }
                        Domain::Room { room } => {
                            let mut members = room.members.clone();
                            if !members.contains(&user_id.to_string()) {
                                members.push(user_id.to_string());
                                room.members = members;
                            }
                        }
                    }
                }
                MemberAction::Remove => {
                    // Implement proper member removal logic here
                    match domain {
                        Domain::Office { office } => {
                            let mut members = office.members.clone();
                            members.retain(|id| id != user_id);
                            office.members = members;
                        }
                        Domain::Room { room } => {
                            let mut members = room.members.clone();
                            members.retain(|id| id != user_id);
                            room.members = members;
                        }
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
        let access_permission = match std::any::type_name::<T>() {
            "Office" => Permission::DeleteOffice,
            "Room" => Permission::DeleteRoom,
            _ => Permission::All,
        };

        let has_permission = self.can_access_domain(user_id, entity_id, access_permission)?;

        if !has_permission {
            return Err(NetworkError::Generic(
                "Permission denied: Only owner or admin can delete".into(),
            ));
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

/// Actions for updating domain members
enum MemberAction {
    Add,
    Remove,
}

impl<R: Ratchet + Send + Sync + 'static> DomainOperations<R> for WorkspaceServerKernel<R> {
    fn init(&self) -> Result<(), NetworkError> {
        // Initialize any required resources
        Ok(())
    }

    fn kernel(&self) -> &WorkspaceServerKernel<R> {
        self
    }

    fn is_admin(&self, user_id: &str) -> bool {
        self.is_admin(user_id)
    }

    fn get_user(&self, user_id: &str) -> Option<User> {
        let users = self.users.read().unwrap();
        users.get(user_id).cloned()
    }

    fn with_read_transaction<F, T>(&self, f: F) -> Result<T, NetworkError>
    where
        F: FnOnce(&dyn Transaction) -> Result<T, NetworkError>,
    {
        let tx = self.domains.read().unwrap();
        let read_tx = ReadTransaction::new(tx);
        f(&read_tx)
    }

    fn with_write_transaction<F, T>(&self, f: F) -> Result<T, NetworkError>
    where
        F: FnOnce(&mut dyn Transaction) -> Result<T, NetworkError>,
    {
        let tx = self.domains.write().unwrap();
        let mut write_tx = WriteTransaction::new(tx);
        let result = f(&mut write_tx);
        if result.is_ok() {
            write_tx.commit()?;
        } else {
            write_tx.rollback();
        }
        result
    }

    fn check_entity_permission(
        &self,
        user_id: &str,
        entity_id: &str,
        permission: Permission,
    ) -> Result<bool, NetworkError> {
        info!(target: "citadel", "Checking permission {:?} for user {} on entity {}", permission, user_id, entity_id);

        // Check if user is admin - admins have all permissions
        if self.is_admin(user_id) {
            info!(target: "citadel", "User {} is admin, permission {:?} granted for entity {}", user_id, permission, entity_id);
            return Ok(true);
        }

        // Get the user
        let user = match self.get_user(user_id) {
            Some(user) => user,
            None => return Err(NetworkError::msg("User not found")),
        };

        // Check if user has the permission for this entity
        self.with_read_transaction(|tx| {
            if let Some(domain) = tx.get_domain(entity_id) {
                match domain {
                    Domain::Office { ref office } => {
                        // Office owners have all permissions for their office
                        if office.owner_id == user_id {
                            return Ok(true);
                        }

                        // Office members may have some permissions based on role
                        if office.members.contains(&user_id.to_string()) {
                            match user.role {
                                UserRole::Admin => Ok(true), // Admins have all permissions
                                UserRole::Owner => Ok(true), // Owners have all permissions for entities they belong to
                                UserRole::Member => {
                                    match permission {
                                        Permission::ViewContent => Ok(true), // Members can view content
                                        _ => Ok(false),
                                    }
                                }
                                _ => Ok(false),
                            }
                        } else {
                            Ok(false)
                        }
                    }
                    Domain::Room { ref room } => {
                        // Room owners have all permissions for their room
                        if room.owner_id == user_id {
                            return Ok(true);
                        }

                        // Room members may have some permissions based on role
                        if room.members.contains(&user_id.to_string()) {
                            match user.role {
                                UserRole::Admin => Ok(true), // Admins have all permissions
                                UserRole::Owner => Ok(true), // Owners have all permissions for entities they belong to
                                UserRole::Member => {
                                    match permission {
                                        Permission::ViewContent => Ok(true),  // Members can view content
                                        Permission::SendMessages => Ok(true), // Members can send messages
                                        Permission::ReadMessages => Ok(true), // Members can read messages
                                        _ => Ok(false),
                                    }
                                }
                                _ => Ok(false),
                            }
                        } else {
                            Ok(false)
                        }
                    }
                }
            } else {
                Err(NetworkError::msg("Entity not found"))
            }
        })
    }

    fn is_member_of_domain(&self, user_id: &str, domain_id: &str) -> Result<bool, NetworkError> {
        self.with_read_transaction(|tx| tx.is_member_of_domain(user_id, domain_id))
    }

    fn check_permission<T: DomainEntity + 'static>(
        &self,
        user_id: &str,
        entity_id: &str,
        permission: Permission,
    ) -> Result<bool, NetworkError> {
        info!(target: "citadel", "Checking permission for user {} on entity {}", user_id, entity_id);
        self.check_entity_permission(user_id, entity_id, permission)
    }

    fn check_room_access(&self, user_id: &str, room_id: &str) -> Result<bool, NetworkError> {
        // Check if user is an admin
        if self.is_admin(user_id) {
            return Ok(true);
        }

        // Check if user is member of the room
        self.with_read_transaction(|tx| {
            if let Some(domain) = tx.get_domain(room_id) {
                match domain {
                    Domain::Room { room } => {
                        Ok(room.owner_id == user_id || room.members.contains(&user_id.to_string()))
                    }
                    _ => Err(NetworkError::msg("Not a room")),
                }
            } else {
                Err(NetworkError::msg("Room not found"))
            }
        })
    }

    fn get_domain(&self, domain_id: &str) -> Option<Domain> {
        let domains = self.domains.read().unwrap();
        domains.get(domain_id).cloned()
    }

    fn add_user_to_domain(
        &self,
        user_id: &str,
        domain_id: &str,
        role: UserRole,
    ) -> Result<(), NetworkError> {
        self.with_write_transaction(|tx| tx.add_user_to_domain(user_id, domain_id, role))
    }

    fn remove_user_from_domain(&self, user_id: &str, domain_id: &str) -> Result<(), NetworkError> {
        self.with_write_transaction(|tx| tx.remove_user_from_domain(user_id, domain_id))
    }

    fn get_domain_entity<T: DomainEntity + 'static>(
        &self,
        user_id: &str,
        entity_id: &str,
    ) -> Result<T, NetworkError> {
        // Check permission first
        let read_permission = Permission::ReadMessages;
        if !self.check_entity_permission(user_id, entity_id, read_permission)? {
            return Err(NetworkError::msg("No permission to get this entity"));
        }

        // Get the domain
        if let Some(domain) = self.get_domain(entity_id) {
            // Convert domain to the requested entity type
            if let Some(entity) = T::from_domain(domain) {
                Ok(entity)
            } else {
                Err(NetworkError::msg(
                    "Domain is not of the requested entity type",
                ))
            }
        } else {
            Err(NetworkError::msg("Entity not found"))
        }
    }

    fn create_domain_entity<T: DomainEntity + 'static>(
        &self,
        user_id: &str,
        parent_id: Option<&str>,
        name: &str,
        description: &str,
    ) -> Result<T, NetworkError> {
        // Generate entity ID
        let entity_id = uuid::Uuid::new_v4().to_string();

        // Check if user has permission to create this entity
        let create_permission = match std::any::type_name::<T>() {
            "Office" => Permission::AddOffice,
            "Room" => Permission::AddRoom,
            _ => Permission::CreateEntity,
        };

        // Permission check (use is_admin for system-wide permissions)
        if !self.is_admin(user_id) {
            if let Some(parent) = parent_id {
                // Check if user has permission to create in this parent
                if !self.check_entity_permission(user_id, parent, create_permission)? {
                    info!(target: "citadel", "User {} denied permission to create entity in parent {}", user_id, parent);
                    return Err(NetworkError::msg(
                        "No permission to create entity in this parent",
                    ));
                }
            } else {
                // For top-level entities, require admin by default
                info!(target: "citadel", "User {} denied admin permission to create top-level entity", user_id);
                return Err(NetworkError::msg(
                    "No permission to create top-level entity",
                ));
            }
        }

        info!(target: "citadel", "User {} creating new entity of type {}", user_id, std::any::type_name::<T>());

        // Create the entity
        let entity = T::create(entity_id.clone(), name, description);

        // Convert to domain and store
        let domain = entity.clone().into_domain();

        // Store domain in a write transaction
        self.with_write_transaction(|tx| {
            tx.insert(entity_id.clone(), domain)?;
            debug!(target: "citadel", "Audit log: User {} created entity {} of type {}", user_id, entity_id, std::any::type_name::<T>());
            Ok(entity)
        })
    }

    fn delete_domain_entity<T: DomainEntity + 'static>(
        &self,
        user_id: &str,
        entity_id: &str,
    ) -> Result<T, NetworkError> {
        // Get entity before deleting it
        let entity = self.get_domain_entity::<T>(user_id, entity_id)?;

        // Check if user has permission to delete this entity
        let delete_permission = match std::any::type_name::<T>() {
            "Office" => Permission::DeleteOffice,
            "Room" => Permission::DeleteRoom,
            _ => Permission::All,
        };

        if !self.check_entity_permission(user_id, entity_id, delete_permission)? {
            info!(target: "citadel", "User {} denied permission to delete entity {}", user_id, entity_id);
            return Err(NetworkError::msg("No permission to delete this entity"));
        }

        info!(target: "citadel", "User {} deleting entity {}", user_id, entity_id);
        debug!(target: "citadel", "Audit log: User {} deleted entity {}", user_id, entity_id);

        // Remove the entity
        self.with_write_transaction(|tx| {
            tx.remove(entity_id)?;
            Ok(entity)
        })
    }

    fn update_domain_entity<T: DomainEntity + 'static>(
        &self,
        user_id: &str,
        entity_id: &str,
        name: Option<&str>,
        description: Option<&str>,
    ) -> Result<T, NetworkError> {
        // Check if user has permission to update this entity
        let update_permission = match std::any::type_name::<T>() {
            "Office" => Permission::UpdateOfficeSettings,
            "Room" => Permission::UpdateRoomSettings,
            _ => Permission::All,
        };

        if !self.check_entity_permission(user_id, entity_id, update_permission)? {
            info!(target: "citadel", "User {} denied permission to update entity {}", user_id, entity_id);
            return Err(NetworkError::msg("No permission to update this entity"));
        }

        info!(target: "citadel", "User {} updating entity {}", user_id, entity_id);

        // Update the entity
        self.with_write_transaction(|tx| {
            if let Some(mut domain) = tx.get_domain(entity_id).cloned() {
                // Update domain properties
                if let Some(name) = name {
                    info!(target: "citadel", "User {} changing name of entity {} to '{}'", user_id, entity_id, name);
                    domain.update_name(name.to_string());
                }
                if let Some(description) = description {
                    info!(target: "citadel", "User {} updating description of entity {}", user_id, entity_id);
                    domain.update_description(description.to_string());
                }

                // Save the updated domain
                let domain_clone = domain.clone();
                tx.update(&entity_id, domain)?;
                let updated_domain = T::from_domain(domain_clone)
                    .ok_or_else(|| NetworkError::msg("Failed to convert domain"))?;
                debug!(target: "citadel", "Audit log: User {} completed update of entity {}", user_id, entity_id);
                Ok(updated_domain)
            } else {
                Err(NetworkError::msg("Entity not found"))
            }
        })
    }

    fn list_domain_entities<T: DomainEntity + 'static>(
        &self,
        user_id: &str,
        parent_id: Option<&str>,
    ) -> Result<Vec<T>, NetworkError> {
        // Check if user is admin or has appropriate permissions
        if !self.is_admin(user_id) {
            if let Some(_parent_id) = parent_id {
                // Check if user has access to the parent domain
                if !self.is_member_of_domain(user_id, _parent_id)? {
                    return Err(NetworkError::msg(
                        "No permission to list entities in this parent",
                    ));
                }
            }
        }

        // List entities
        self.with_read_transaction(|tx| {
            let mut entities = Vec::new();

            for (_, domain) in tx.get_domains().iter() {
                // Check if domain has the expected parent
                let domain_parent_matches = match domain {
                    Domain::Office { .. } => {
                        if let Some(_parent) = &parent_id {
                            false // Offices don't have parents
                        } else {
                            true // Offices are always top-level entities
                        }
                    }
                    Domain::Room { room } => {
                        if let Some(_parent) = &parent_id {
                            room.office_id == *_parent
                        } else {
                            false // Rooms always have a parent office
                        }
                    }
                };

                if domain_parent_matches {
                    if let Some(entity) = T::from_domain(domain.clone()) {
                        entities.push(entity);
                    }
                }
            }

            Ok(entities)
        })
    }

    fn create_office(
        &self,
        user_id: &str,
        name: &str,
        description: &str,
    ) -> Result<Office, NetworkError> {
        // Use the generic method with Office type
        self.create_domain_entity::<Office>(user_id, None, name, description)
    }

    fn create_room(
        &self,
        user_id: &str,
        office_id: &str,
        name: &str,
        description: &str,
    ) -> Result<Room, NetworkError> {
        // Use the generic method with Room type
        self.create_domain_entity::<Room>(user_id, Some(office_id), name, description)
    }

    fn get_office(&self, user_id: &str, office_id: &str) -> Result<Office, NetworkError> {
        // Use the generic method with Office type
        self.get_domain_entity::<Office>(user_id, office_id)
    }

    fn get_room(&self, user_id: &str, room_id: &str) -> Result<Room, NetworkError> {
        // Use the generic method with Room type
        self.get_domain_entity::<Room>(user_id, room_id)
    }

    fn delete_office(&self, user_id: &str, office_id: &str) -> Result<Office, NetworkError> {
        let _office = self.get_office(user_id, office_id)?;
        self.delete_domain_entity::<Office>(user_id, office_id)
    }

    fn delete_room(&self, user_id: &str, room_id: &str) -> Result<Room, NetworkError> {
        let _room = self.get_room(user_id, room_id)?;
        self.delete_domain_entity::<Room>(user_id, room_id)
    }

    fn update_office(
        &self,
        user_id: &str,
        office_id: &str,
        name: Option<&str>,
        description: Option<&str>,
    ) -> Result<Office, NetworkError> {
        // Get the office before updating to check if it exists
        let _office = self.get_office(user_id, office_id)?;

        // Update the office
        self.update_domain_entity::<Office>(user_id, office_id, name, description)
    }

    fn update_room(
        &self,
        user_id: &str,
        room_id: &str,
        name: Option<&str>,
        description: Option<&str>,
    ) -> Result<Room, NetworkError> {
        // Get the room before updating to check if it exists
        let _room = self.get_room(user_id, room_id)?;

        // Update the room
        self.update_domain_entity::<Room>(user_id, room_id, name, description)
    }

    fn list_offices(&self, user_id: &str) -> Result<Vec<Office>, NetworkError> {
        // Use the generic method with Office type
        self.list_domain_entities::<Office>(user_id, None)
    }

    fn list_rooms(&self, user_id: &str, office_id: &str) -> Result<Vec<Room>, NetworkError> {
        // Use the generic method with Room type
        self.list_domain_entities::<Room>(user_id, Some(office_id))
    }
}

impl<R: Ratchet> WorkspaceServerKernel<R> {
    fn can_access_domain(
        &self,
        user_id: &str,
        entity_id: &str,
        permission: Permission,
    ) -> Result<bool, NetworkError> {
        info!(target: "citadel", "Checking domain access permission for user {} on entity {}", user_id, entity_id);
        self.check_entity_permission(user_id, entity_id, permission)
    }

    fn create_user(
        &self,
        admin_id: &str,
        username: &str,
        role: UserRole,
    ) -> Result<(), NetworkError> {
        // Only admins can create users
        if !self.is_admin(admin_id) {
            info!(target: "citadel", "User {} denied admin permission to create new user", admin_id);
            return Err(NetworkError::msg("Only administrators can create users"));
        }

        info!(target: "citadel", "Admin {} creating new user {} with role {:?}", admin_id, username, role);

        let user_id = uuid::Uuid::new_v4().to_string();
        let role_for_log = role.clone(); // Clone role for logging later
        let new_user = User::new(user_id.clone(), username.to_string(), role);

        // Add user to system
        {
            let mut users = self.users.write().unwrap();
            users.insert(user_id.clone(), new_user);
        }

        // Add user to roles
        {
            let mut roles = self.roles.write().unwrap();
            roles.roles.insert(user_id, role_for_log.clone());
        }

        debug!(target: "citadel", "Audit log: Admin {} created user {} with role {:?}", admin_id, username, role_for_log);
        Ok(())
    }

    fn add_user_to_domain(
        &self,
        admin_id: &str,
        user_id: &str,
        domain_id: &str,
        role: UserRole,
    ) -> Result<(), NetworkError> {
        // Check if admin has permission to add users
        if !self.is_admin(admin_id)
            && !self.check_entity_permission(admin_id, domain_id, Permission::ManageUsers)?
        {
            info!(target: "citadel", "User {} denied permission to add user {} to domain {}", admin_id, user_id, domain_id);
            return Err(NetworkError::msg(
                "No permission to add users to this domain",
            ));
        }

        info!(target: "citadel", "User {} adding user {} to domain {} with role {:?}", admin_id, user_id, domain_id, role);
        let role_for_log = role.clone(); // Clone role for logging later

        // Add user to domain
        self.with_write_transaction(|tx| {
            tx.add_user_to_domain(user_id, domain_id, role.clone()).map_err(|e| {
                debug!(target: "citadel", "Failed to add user {} to domain {}: {:?}", user_id, domain_id, e);
                e
            })
        })?;

        debug!(target: "citadel", "Audit log: User {} added user {} to domain {} with role {:?}", admin_id, user_id, domain_id, role_for_log);
        Ok(())
    }

    fn remove_user_from_domain(
        &self,
        admin_id: &str,
        user_id: &str,
        domain_id: &str,
    ) -> Result<(), NetworkError> {
        // Check if admin has permission to remove users
        if !self.is_admin(admin_id)
            && !self.check_entity_permission(admin_id, domain_id, Permission::ManageUsers)?
        {
            info!(target: "citadel", "User {} denied permission to remove user {} from domain {}", admin_id, user_id, domain_id);
            return Err(NetworkError::msg(
                "No permission to remove users from this domain",
            ));
        }

        info!(target: "citadel", "User {} removing user {} from domain {}", admin_id, user_id, domain_id);

        // Remove user from domain
        self.with_write_transaction(|tx| {
            tx.remove_user_from_domain(user_id, domain_id).map_err(|e| {
                debug!(target: "citadel", "Failed to remove user {} from domain {}: {:?}", user_id, domain_id, e);
                e
            })
        })?;

        debug!(target: "citadel", "Audit log: User {} removed user {} from domain {}", admin_id, user_id, domain_id);
        Ok(())
    }

    fn set_user_role(
        &self,
        admin_id: &str,
        user_id: &str,
        role: UserRole,
    ) -> Result<(), NetworkError> {
        // Only admins can set user roles
        if !self.is_admin(admin_id) {
            info!(target: "citadel", "User {} denied admin permission to set role for user {}", admin_id, user_id);
            return Err(NetworkError::msg("Only administrators can set user roles"));
        }

        info!(target: "citadel", "Admin {} setting role {:?} for user {}", admin_id, role, user_id);
        let role_for_user = role.clone(); // Clone for user update
        let role_for_roles = role.clone(); // Clone for roles update
        let role_for_log = role.clone(); // Clone for logging

        // Update user in the system
        {
            let mut users = self.users.write().unwrap();
            if let Some(user) = users.get_mut(user_id) {
                user.role = role_for_user;
            } else {
                return Err(NetworkError::msg("User not found"));
            }
        }

        // Update user in roles
        {
            let mut roles = self.roles.write().unwrap();
            roles.roles.insert(user_id.to_string(), role_for_roles);
        }

        debug!(target: "citadel", "Audit log: Admin {} set role {:?} for user {}", admin_id, role_for_log, user_id);
        Ok(())
    }

    fn set_domain_permission(
        &self,
        admin_id: &str,
        domain_id: &str,
        user_id: &str,
        permission: Permission,
        allow: bool,
    ) -> Result<(), NetworkError> {
        // Check if admin has permission to manage permissions
        if !self.is_admin(admin_id)
            && !self.check_entity_permission(admin_id, domain_id, Permission::ManageUsers)?
        {
            info!(target: "citadel", "User {} denied permission to set permissions for domain {}", admin_id, domain_id);
            return Err(NetworkError::msg(
                "No permission to manage permissions for this domain",
            ));
        }

        info!(target: "citadel", "User {} {}granting permission {:?} to user {} for domain {}", 
            admin_id, if allow { "" } else { "removing/" }, permission, user_id, domain_id);

        // Update domain permissions
        self.with_write_transaction(|tx| {
            if let Some(mut domain) = tx.get_domain(domain_id).cloned() {
                // Get the user from the system
                let mut users = self.users.write().unwrap();
                if let Some(user) = users.get_mut(user_id) {
                    let mut user_permissions = match user.get_permissions(domain_id).cloned() {
                        Some(perms) => perms,
                        None => HashSet::new(),
                    };

                    // Update permission
                    if allow {
                        user_permissions.insert(permission);
                    } else {
                        user_permissions.remove(&permission);
                    }

                    // Update user's permissions for this domain
                    user.permissions
                        .insert(domain_id.to_string(), user_permissions);

                    // Save updated domain
                    tx.update(domain_id, domain)
                } else {
                    Err(NetworkError::msg("User not found"))
                }
            } else {
                Err(NetworkError::msg("Domain not found"))
            }
        })?;

        debug!(target: "citadel", "Audit log: User {} {}granted permission {:?} to user {} for domain {}", 
            admin_id, if allow { "" } else { "removed/" }, permission, user_id, domain_id);
        Ok(())
    }
}
