use citadel_logging::{debug, error, info, warn};
use citadel_sdk::async_trait;
use citadel_sdk::prelude::{
    BackendType, NetKernel, NetworkError, NodeBuilder, NodeRemote, NodeResult, NodeType, Ratchet,
    StackedRatchet,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::error::Error;
use std::marker::PhantomData;
use std::net::SocketAddr;
use std::sync::{Arc, RwLock};
use structopt::StructOpt;

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    citadel_logging::setup_log();
    let opts: Options = Options::from_args();
    let service = WorkspaceServerKernel::<StackedRatchet>::default();
    let mut builder = NodeBuilder::default();
    let mut builder = builder
        .with_backend(BackendType::InMemory)
        .with_node_type(NodeType::server(opts.bind)?);

    if opts.dangerous.unwrap_or(false) {
        builder = builder.with_insecure_skip_cert_verification()
    }

    builder.build(service)?.await?;

    Ok(())
}

#[derive(Debug, StructOpt)]
#[structopt(
    name = "citadel-service-bin",
    about = "Used for running a local service for citadel applications"
)]
struct Options {
    #[structopt(short, long)]
    bind: SocketAddr,
    #[structopt(short, long)]
    dangerous: Option<bool>,
}

// Workspace metadata structures
#[derive(Debug, Clone, Serialize, Deserialize)]
struct User {
    id: String,
    name: String,
    role: UserRole,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
enum UserRole {
    Admin,
    Member,
    Guest,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Office {
    id: String,
    name: String,
    description: String,
    owner_id: String,
    members: Vec<String>, // User IDs
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Room {
    id: String,
    office_id: String,
    name: String,
    description: String,
    members: Vec<String>, // User IDs
}

// Command protocol structures
#[derive(Debug, Clone, Serialize, Deserialize)]
enum WorkspaceCommand {
    // Office commands
    CreateOffice {
        name: String,
        description: String,
    },
    DeleteOffice {
        office_id: String,
    },
    UpdateOffice {
        office_id: String,
        name: Option<String>,
        description: Option<String>,
    },

    // Room commands
    CreateRoom {
        office_id: String,
        name: String,
        description: String,
    },
    DeleteRoom {
        room_id: String,
    },
    UpdateRoom {
        room_id: String,
        name: Option<String>,
        description: Option<String>,
    },

    // Member commands
    AddMember {
        user_id: String,
        office_id: Option<String>,
        room_id: Option<String>,
        role: UserRole,
    },
    RemoveMember {
        user_id: String,
        office_id: Option<String>,
        room_id: Option<String>,
    },
    UpdateMemberRole {
        user_id: String,
        role: UserRole,
    },

    // Query commands
    ListOffices,
    ListRooms {
        office_id: String,
    },
    ListMembers {
        office_id: Option<String>,
        room_id: Option<String>,
    },
    GetOffice {
        office_id: String,
    },
    GetRoom {
        room_id: String,
    },
    GetMember {
        user_id: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
enum WorkspaceResponse {
    Success,
    Error(String),
    Offices(Vec<Office>),
    Rooms(Vec<Room>),
    Members(Vec<User>),
    Office(Office),
    Room(Room),
    Member(User),
}

// Server kernel implementation
struct WorkspaceServerKernel<R: Ratchet> {
    users: Arc<RwLock<HashMap<String, User>>>,
    offices: Arc<RwLock<HashMap<String, Office>>>,
    rooms: Arc<RwLock<HashMap<String, Room>>>,
    remote: Option<NodeRemote<R>>,
    _marker: PhantomData<R>,
}

impl<R: Ratchet> Default for WorkspaceServerKernel<R> {
    fn default() -> Self {
        // Initialize with a default admin user
        let mut users = HashMap::new();
        users.insert(
            "admin".to_string(),
            User {
                id: "admin".to_string(),
                name: "Administrator".to_string(),
                role: UserRole::Admin,
            },
        );

        WorkspaceServerKernel {
            users: Arc::new(RwLock::new(users)),
            offices: Arc::new(RwLock::new(HashMap::new())),
            rooms: Arc::new(RwLock::new(HashMap::new())),
            remote: None,
            _marker: PhantomData,
        }
    }
}

impl<R: Ratchet> WorkspaceServerKernel<R> {
    // Helper methods for permission checking
    fn check_permission(&self, user_id: &str, required_role: UserRole) -> Result<(), NetworkError> {
        let users = self.users.read().unwrap();

        if let Some(user) = users.get(user_id) {
            if user.role == UserRole::Admin || user.role == required_role {
                Ok(())
            } else {
                Err(NetworkError::msg(
                    "Permission denied: Insufficient privileges",
                ))
            }
        } else {
            Err(NetworkError::msg("User not found"))
        }
    }

    // Office management methods
    fn create_office(
        &self,
        user_id: &str,
        name: String,
        description: String,
    ) -> Result<Office, NetworkError> {
        self.check_permission(user_id, UserRole::Admin)?;

        let office_id = format!("office_{}", uuid::Uuid::new_v4());
        let office = Office {
            id: office_id.clone(),
            name,
            description,
            owner_id: user_id.to_string(),
            members: vec![user_id.to_string()],
        };

        let mut offices = self.offices.write().unwrap();
        offices.insert(office_id, office.clone());

        Ok(office)
    }

    fn delete_office(&self, user_id: &str, office_id: &str) -> Result<(), NetworkError> {
        let offices = self.offices.read().unwrap();

        if let Some(office) = offices.get(office_id) {
            if office.owner_id == user_id || self.check_permission(user_id, UserRole::Admin).is_ok()
            {
                drop(offices);

                // Remove all rooms in this office
                let rooms = self.rooms.read().unwrap();
                let rooms_to_delete: Vec<String> = rooms
                    .iter()
                    .filter(|(_, room)| room.office_id == office_id)
                    .map(|(id, _)| id.clone())
                    .collect();
                drop(rooms);

                let mut rooms = self.rooms.write().unwrap();
                for room_id in rooms_to_delete {
                    rooms.remove(&room_id);
                }

                // Remove the office
                let mut offices = self.offices.write().unwrap();
                offices.remove(office_id);

                Ok(())
            } else {
                Err(NetworkError::msg(
                    "Permission denied: Only office owner or admin can delete an office",
                ))
            }
        } else {
            Err(NetworkError::msg("Office not found"))
        }
    }

    fn update_office(
        &self,
        user_id: &str,
        office_id: &str,
        name: Option<String>,
        description: Option<String>,
    ) -> Result<Office, NetworkError> {
        let mut offices = self.offices.write().unwrap();

        if let Some(office) = offices.get_mut(office_id) {
            if office.owner_id == user_id || self.check_permission(user_id, UserRole::Admin).is_ok()
            {
                if let Some(name) = name {
                    office.name = name;
                }

                if let Some(description) = description {
                    office.description = description;
                }

                Ok(office.clone())
            } else {
                Err(NetworkError::msg(
                    "Permission denied: Only office owner or admin can update an office",
                ))
            }
        } else {
            Err(NetworkError::msg("Office not found"))
        }
    }

    // Room management methods
    fn create_room(
        &self,
        user_id: &str,
        office_id: &str,
        name: String,
        description: String,
    ) -> Result<Room, NetworkError> {
        let offices = self.offices.read().unwrap();

        if let Some(office) = offices.get(office_id) {
            if office.members.contains(&user_id.to_string())
                || self.check_permission(user_id, UserRole::Admin).is_ok()
            {
                let room_id = format!("room_{}", uuid::Uuid::new_v4());
                let room = Room {
                    id: room_id.clone(),
                    office_id: office_id.to_string(),
                    name,
                    description,
                    members: vec![user_id.to_string()],
                };

                drop(offices);
                let mut rooms = self.rooms.write().unwrap();
                rooms.insert(room_id, room.clone());

                Ok(room)
            } else {
                Err(NetworkError::msg(
                    "Permission denied: You must be a member of the office to create a room",
                ))
            }
        } else {
            Err(NetworkError::msg("Office not found"))
        }
    }

    fn delete_room(&self, user_id: &str, room_id: &str) -> Result<(), NetworkError> {
        let rooms = self.rooms.read().unwrap();

        if let Some(room) = rooms.get(room_id) {
            let offices = self.offices.read().unwrap();

            if let Some(office) = offices.get(&room.office_id) {
                if office.owner_id == user_id
                    || self.check_permission(user_id, UserRole::Admin).is_ok()
                {
                    drop(rooms);
                    drop(offices);

                    let mut rooms = self.rooms.write().unwrap();
                    rooms.remove(room_id);

                    Ok(())
                } else {
                    Err(NetworkError::msg(
                        "Permission denied: Only office owner or admin can delete a room",
                    ))
                }
            } else {
                Err(NetworkError::msg("Office not found"))
            }
        } else {
            Err(NetworkError::msg("Room not found"))
        }
    }

    fn update_room(
        &self,
        user_id: &str,
        room_id: &str,
        name: Option<String>,
        description: Option<String>,
    ) -> Result<Room, NetworkError> {
        let mut rooms = self.rooms.write().unwrap();

        if let Some(room) = rooms.get_mut(room_id) {
            let offices = self.offices.read().unwrap();

            if let Some(office) = offices.get(&room.office_id) {
                if office.owner_id == user_id
                    || self.check_permission(user_id, UserRole::Admin).is_ok()
                {
                    if let Some(name) = name {
                        room.name = name;
                    }

                    if let Some(description) = description {
                        room.description = description;
                    }

                    Ok(room.clone())
                } else {
                    Err(NetworkError::msg(
                        "Permission denied: Only office owner or admin can update a room",
                    ))
                }
            } else {
                Err(NetworkError::msg("Office not found"))
            }
        } else {
            Err(NetworkError::msg("Room not found"))
        }
    }

    // Member management methods
    fn add_member(
        &self,
        admin_id: &str,
        user_id: &str,
        office_id: Option<String>,
        room_id: Option<String>,
        role: UserRole,
    ) -> Result<(), NetworkError> {
        // Check if admin has permission
        self.check_permission(admin_id, UserRole::Admin)?;

        // Check if user exists, if not create a new user
        let mut users = self.users.write().unwrap();
        if !users.contains_key(user_id) {
            users.insert(
                user_id.to_string(),
                User {
                    id: user_id.to_string(),
                    name: format!("User {}", user_id),
                    role,
                },
            );
        } else {
            // Update role if user exists
            if let Some(user) = users.get_mut(user_id) {
                user.role = role;
            }
        }
        drop(users);

        // Add to office if specified
        if let Some(office_id) = office_id {
            let mut offices = self.offices.write().unwrap();

            if let Some(office) = offices.get_mut(&office_id) {
                if !office.members.contains(&user_id.to_string()) {
                    office.members.push(user_id.to_string());
                }
            } else {
                return Err(NetworkError::msg("Office not found"));
            }
        }

        // Add to room if specified
        if let Some(room_id) = room_id {
            let mut rooms = self.rooms.write().unwrap();

            if let Some(room) = rooms.get_mut(&room_id) {
                if !room.members.contains(&user_id.to_string()) {
                    room.members.push(user_id.to_string());
                }
            } else {
                return Err(NetworkError::msg("Room not found"));
            }
        }

        Ok(())
    }

    fn remove_member(
        &self,
        admin_id: &str,
        user_id: &str,
        office_id: Option<String>,
        room_id: Option<String>,
    ) -> Result<(), NetworkError> {
        // Check if admin has permission
        self.check_permission(admin_id, UserRole::Admin)?;

        // Remove from office if specified
        if let Some(office_id) = office_id {
            let mut offices = self.offices.write().unwrap();

            if let Some(office) = offices.get_mut(&office_id) {
                office.members.retain(|id| id != user_id);
            } else {
                return Err(NetworkError::msg("Office not found"));
            }
        }

        // Remove from room if specified
        if let Some(room_id) = room_id {
            let mut rooms = self.rooms.write().unwrap();

            if let Some(room) = rooms.get_mut(&room_id) {
                room.members.retain(|id| id != user_id);
            } else {
                return Err(NetworkError::msg("Room not found"));
            }
        }

        Ok(())
    }

    fn update_member_role(
        &self,
        admin_id: &str,
        user_id: &str,
        role: UserRole,
    ) -> Result<User, NetworkError> {
        // Check if admin has permission
        self.check_permission(admin_id, UserRole::Admin)?;

        let mut users = self.users.write().unwrap();

        if let Some(user) = users.get_mut(user_id) {
            user.role = role;
            Ok(user.clone())
        } else {
            Err(NetworkError::msg("User not found"))
        }
    }

    // Query methods
    fn list_offices(&self) -> Vec<Office> {
        let offices = self.offices.read().unwrap();
        offices.values().cloned().collect()
    }

    fn list_rooms(&self, office_id: &str) -> Vec<Room> {
        let rooms = self.rooms.read().unwrap();
        rooms
            .values()
            .filter(|room| room.office_id == office_id)
            .cloned()
            .collect()
    }

    fn list_members(&self, office_id: Option<String>, room_id: Option<String>) -> Vec<User> {
        let users = self.users.read().unwrap();

        if let Some(office_id) = office_id {
            let offices = self.offices.read().unwrap();

            if let Some(office) = offices.get(&office_id) {
                return office
                    .members
                    .iter()
                    .filter_map(|user_id| users.get(user_id).cloned())
                    .collect();
            }
        }

        if let Some(room_id) = room_id {
            let rooms = self.rooms.read().unwrap();

            if let Some(room) = rooms.get(&room_id) {
                return room
                    .members
                    .iter()
                    .filter_map(|user_id| users.get(user_id).cloned())
                    .collect();
            }
        }

        users.values().cloned().collect()
    }

    fn get_office(&self, office_id: &str) -> Option<Office> {
        let offices = self.offices.read().unwrap();
        offices.get(office_id).cloned()
    }

    fn get_room(&self, room_id: &str) -> Option<Room> {
        let rooms = self.rooms.read().unwrap();
        rooms.get(room_id).cloned()
    }

    fn get_member(&self, user_id: &str) -> Option<User> {
        let users = self.users.read().unwrap();
        users.get(user_id).cloned()
    }

    // Process a command and return a response
    fn process_command(
        &self,
        user_id: &str,
        command: WorkspaceCommand,
    ) -> Result<WorkspaceResponse, NetworkError> {
        match command {
            // Office commands
            WorkspaceCommand::CreateOffice { name, description } => {
                match self.create_office(user_id, name, description) {
                    Ok(office) => Ok(WorkspaceResponse::Office(office)),
                    Err(e) => Ok(WorkspaceResponse::Error(format!(
                        "Failed to create office: {}",
                        e
                    ))),
                }
            }
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
            } => match self.update_office(user_id, &office_id, name, description) {
                Ok(office) => Ok(WorkspaceResponse::Office(office)),
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
            } => match self.create_room(user_id, &office_id, name, description) {
                Ok(room) => Ok(WorkspaceResponse::Room(room)),
                Err(e) => Ok(WorkspaceResponse::Error(format!(
                    "Failed to create room: {}",
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
            } => match self.update_room(user_id, &room_id, name, description) {
                Ok(room) => Ok(WorkspaceResponse::Room(room)),
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
            } => match self.add_member(user_id, &member_id, office_id, room_id, role) {
                Ok(_) => Ok(WorkspaceResponse::Success),
                Err(e) => Ok(WorkspaceResponse::Error(format!(
                    "Failed to add member: {}",
                    e
                ))),
            },
            WorkspaceCommand::RemoveMember {
                user_id: member_id,
                office_id,
                room_id,
            } => match self.remove_member(user_id, &member_id, office_id, room_id) {
                Ok(_) => Ok(WorkspaceResponse::Success),
                Err(e) => Ok(WorkspaceResponse::Error(format!(
                    "Failed to remove member: {}",
                    e
                ))),
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

            // Query commands
            WorkspaceCommand::ListOffices => {
                let offices = self.list_offices();
                Ok(WorkspaceResponse::Offices(offices))
            }
            WorkspaceCommand::ListRooms { office_id } => {
                let rooms = self.list_rooms(&office_id);
                Ok(WorkspaceResponse::Rooms(rooms))
            }
            WorkspaceCommand::ListMembers { office_id, room_id } => {
                let members = self.list_members(office_id, room_id);
                Ok(WorkspaceResponse::Members(members))
            }
            WorkspaceCommand::GetOffice { office_id } => match self.get_office(&office_id) {
                Some(office) => Ok(WorkspaceResponse::Office(office)),
                None => Ok(WorkspaceResponse::Error("Office not found".to_string())),
            },
            WorkspaceCommand::GetRoom { room_id } => match self.get_room(&room_id) {
                Some(room) => Ok(WorkspaceResponse::Room(room)),
                None => Ok(WorkspaceResponse::Error("Room not found".to_string())),
            },
            WorkspaceCommand::GetMember { user_id: member_id } => {
                match self.get_member(&member_id) {
                    Some(member) => Ok(WorkspaceResponse::Member(member)),
                    None => Ok(WorkspaceResponse::Error("Member not found".to_string())),
                }
            }
        }
    }
}

#[async_trait]
impl<R: Ratchet> NetKernel<R> for WorkspaceServerKernel<R> {
    fn load_remote(&mut self, server_remote: NodeRemote<R>) -> Result<(), NetworkError> {
        self.remote = Some(server_remote);
        Ok(())
    }

    async fn on_start(&self) -> Result<(), NetworkError> {
        // Initialize any resources needed when the server starts
        info!("WorkspaceServerKernel started");
        Ok(())
    }

    async fn on_node_event_received(&self, message: NodeResult<R>) -> Result<(), NetworkError> {
        debug!("Received node event: {:?}", message);

        // For now, just log the event and return OK
        // In a real implementation, we would handle different types of events
        // based on the actual NodeResult variants available in the SDK

        // The specific variants and methods would need to be determined by examining
        // the actual implementation of NodeResult and NodeRemote in the citadel_sdk

        info!("Processing node event");

        // Example of how to handle a request once we know the correct variant:
        /*
        match message {
            NodeResult::SomeRequestVariant(request) => {
                // Extract user ID from request metadata
                let user_id = request.header.metadata.get("user_id")
                    .cloned()
                    .unwrap_or_else(|| "admin".to_string());

                // Try to parse the command from the request payload
                match serde_json::from_slice::<WorkspaceCommand>(&request.payload) {
                    Ok(command) => {
                        // Process the command
                        match self.process_command(&user_id, command) {
                            Ok(response) => {
                                // Send the response back using the correct method
                                if let Some(remote) = &self.remote {
                                    let response_payload = serde_json::to_vec(&response)
                                        .map_err(|e| NetworkError::msg(format!("Serialization error: {}", e)))?;

                                    // Use the correct method to send a response
                                    remote.some_response_method(request.header, response_payload).await?;
                                }
                            },
                            Err(e) => {
                                // Send error response using the correct method
                                if let Some(remote) = &self.remote {
                                    // Use the correct method to send an error
                                    remote.some_error_method(request.header, format!("Command processing error: {}", e)).await?;
                                }
                            }
                        }
                    },
                    Err(e) => {
                        // Failed to parse command, send error response
                        if let Some(remote) = &self.remote {
                            // Use the correct method to send an error
                            remote.some_error_method(request.header, format!("Failed to parse command: {}", e)).await?;
                        }
                    }
                }
            },
            _ => {
                debug!("Unhandled node event type");
            }
        }
        */

        Ok(())
    }

    async fn on_stop(&mut self) -> Result<(), NetworkError> {
        // Clean up any resources when the server stops
        info!("WorkspaceServerKernel stopped");
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::test;

    // Helper function to create a test kernel
    fn create_test_kernel() -> WorkspaceServerKernel<StackedRatchet> {
        WorkspaceServerKernel::<StackedRatchet>::default()
    }

    // Helper function to create a test kernel with a regular user
    fn create_kernel_with_user() -> (WorkspaceServerKernel<StackedRatchet>, String) {
        let kernel = create_test_kernel();
        let user_id = "regular_user".to_string();

        // Add a regular user
        kernel
            .add_member("admin", &user_id, None, None, UserRole::Member)
            .unwrap();

        (kernel, user_id)
    }

    #[test]
    async fn test_create_office() {
        let kernel = create_test_kernel();

        // Test creating an office as admin
        let result = kernel.create_office(
            "admin",
            "Test Office".to_string(),
            "Test Description".to_string(),
        );
        assert!(result.is_ok(), "Admin should be able to create an office");

        if let Ok(office) = result {
            assert_eq!(office.name, "Test Office");
            assert_eq!(office.description, "Test Description");
            assert_eq!(office.owner_id, "admin");
            assert!(office.members.contains(&"admin".to_string()));
        }
    }

    #[test]
    async fn test_permission_check() {
        let kernel = create_test_kernel();

        // Add a regular user
        let add_result = kernel.add_member("admin", "user1", None, None, UserRole::Member);
        assert!(add_result.is_ok(), "Failed to add member");

        // Test permission check
        let admin_perm = kernel.check_permission("admin", UserRole::Admin);
        assert!(admin_perm.is_ok(), "Admin should have admin permissions");

        let user_perm = kernel.check_permission("user1", UserRole::Admin);
        assert!(
            user_perm.is_err(),
            "Regular user should not have admin permissions"
        );
    }

    #[test]
    async fn test_office_operations() {
        let kernel = create_test_kernel();

        // Create an office
        let office = kernel
            .create_office(
                "admin",
                "Test Office".to_string(),
                "Test Description".to_string(),
            )
            .unwrap();
        let office_id = office.id.clone();

        // Update the office
        let update_result = kernel.update_office(
            "admin",
            &office_id,
            Some("Updated Office".to_string()),
            Some("Updated Description".to_string()),
        );
        assert!(update_result.is_ok(), "Failed to update office");

        if let Ok(updated) = update_result {
            assert_eq!(updated.name, "Updated Office");
            assert_eq!(updated.description, "Updated Description");
        }

        // Delete the office
        let delete_result = kernel.delete_office("admin", &office_id);
        assert!(delete_result.is_ok(), "Failed to delete office");

        // Verify office is deleted
        let get_result = kernel.get_office(&office_id);
        assert!(get_result.is_none(), "Office should be deleted");
    }

    #[test]
    async fn test_room_operations() {
        let kernel = create_test_kernel();

        // Create an office first
        let office = kernel
            .create_office(
                "admin",
                "Test Office".to_string(),
                "Test Description".to_string(),
            )
            .unwrap();
        let office_id = office.id.clone();

        // Create a room in the office
        let room_result = kernel.create_room(
            "admin",
            &office_id,
            "Test Room".to_string(),
            "Test Room Description".to_string(),
        );
        assert!(room_result.is_ok(), "Failed to create room");

        let room = room_result.unwrap();
        let room_id = room.id.clone();

        // Update the room
        let update_result = kernel.update_room(
            "admin",
            &room_id,
            Some("Updated Room".to_string()),
            Some("Updated Room Description".to_string()),
        );
        assert!(update_result.is_ok(), "Failed to update room");

        if let Ok(updated) = update_result {
            assert_eq!(updated.name, "Updated Room");
            assert_eq!(updated.description, "Updated Room Description");
        }

        // Delete the room
        let delete_result = kernel.delete_room("admin", &room_id);
        assert!(delete_result.is_ok(), "Failed to delete room");

        // Verify room is deleted
        let get_result = kernel.get_room(&room_id);
        assert!(get_result.is_none(), "Room should be deleted");
    }

    #[test]
    async fn test_member_operations() {
        let kernel = create_test_kernel();

        // Create an office
        let office = kernel
            .create_office(
                "admin",
                "Test Office".to_string(),
                "Test Description".to_string(),
            )
            .unwrap();
        let office_id = office.id.clone();

        // Add a member to the office
        let add_result = kernel.add_member(
            "admin",
            "user1",
            Some(office_id.clone()),
            None,
            UserRole::Member,
        );
        assert!(add_result.is_ok(), "Failed to add member to office");

        // Check if member is in the office
        let members = kernel.list_members(Some(office_id.clone()), None);
        assert!(
            members.iter().any(|m| m.id == "user1"),
            "Member should be in the office"
        );

        // Update member role
        let update_result = kernel.update_member_role("admin", "user1", UserRole::Admin);
        assert!(update_result.is_ok(), "Failed to update member role");

        if let Ok(updated) = update_result {
            assert_eq!(updated.role, UserRole::Admin);
        }

        // Remove member from office
        let remove_result = kernel.remove_member("admin", "user1", Some(office_id.clone()), None);
        assert!(remove_result.is_ok(), "Failed to remove member from office");

        // Check if member is removed from the office
        let members_after = kernel.list_members(Some(office_id), None);
        assert!(
            !members_after.iter().any(|m| m.id == "user1"),
            "Member should be removed from the office"
        );
    }

    #[test]
    async fn test_command_processing() {
        let kernel = create_test_kernel();

        // Test create office command
        let create_cmd = WorkspaceCommand::CreateOffice {
            name: "Command Test Office".to_string(),
            description: "Created via command".to_string(),
        };

        let result = kernel.process_command("admin", create_cmd);
        assert!(result.is_ok(), "Command processing failed");

        if let Ok(WorkspaceResponse::Office(office)) = result {
            // Test list offices command
            let list_cmd = WorkspaceCommand::ListOffices;
            let list_result = kernel.process_command("admin", list_cmd);

            if let Ok(WorkspaceResponse::Offices(offices)) = list_result {
                assert!(!offices.is_empty(), "Offices list should not be empty");
                assert!(
                    offices.iter().any(|o| o.id == office.id),
                    "Created office should be in the list"
                );
            } else {
                panic!("List offices command failed");
            }

            // Test get office command
            let get_cmd = WorkspaceCommand::GetOffice {
                office_id: office.id.clone(),
            };

            let get_result = kernel.process_command("admin", get_cmd);
            assert!(get_result.is_ok(), "Get office command failed");

            // Test delete office command
            let delete_cmd = WorkspaceCommand::DeleteOffice {
                office_id: office.id,
            };

            let delete_result = kernel.process_command("admin", delete_cmd);
            assert!(delete_result.is_ok(), "Delete office command failed");

            if let Ok(WorkspaceResponse::Success) = delete_result {
                // Success
            } else {
                panic!("Delete office command did not return Success");
            }
        } else {
            panic!("Create office command did not return an Office");
        }
    }

    #[test]
    async fn test_permission_denied() {
        let (kernel, user_id) = create_kernel_with_user();

        // Try to create an office as a regular user (should fail)
        let result = kernel.create_office(
            &user_id,
            "Test Office".to_string(),
            "Test Description".to_string(),
        );
        assert!(
            result.is_err(),
            "Regular user should not be able to create an office"
        );

        if let Err(e) = result {
            assert!(
                e.to_string().contains("Permission denied"),
                "Error should mention permission denied"
            );
        }

        // Create an office as admin
        let office = kernel
            .create_office(
                "admin",
                "Admin Office".to_string(),
                "Admin Description".to_string(),
            )
            .unwrap();

        // Try to delete the office as a regular user (should fail)
        let delete_result = kernel.delete_office(&user_id, &office.id);
        assert!(
            delete_result.is_err(),
            "Regular user should not be able to delete an office"
        );
    }

    #[test]
    async fn test_not_found_errors() {
        let kernel = create_test_kernel();

        // Try to get a non-existent office
        let office_result = kernel.get_office("non_existent_office");
        assert!(
            office_result.is_none(),
            "Non-existent office should return None"
        );

        // Try to get a non-existent room
        let room_result = kernel.get_room("non_existent_room");
        assert!(
            room_result.is_none(),
            "Non-existent room should return None"
        );

        // Try to get a non-existent member
        let member_result = kernel.get_member("non_existent_user");
        assert!(
            member_result.is_none(),
            "Non-existent member should return None"
        );

        // Try to delete a non-existent office
        let delete_result = kernel.delete_office("admin", "non_existent_office");
        assert!(
            delete_result.is_err(),
            "Deleting non-existent office should return error"
        );

        if let Err(e) = delete_result {
            assert!(
                e.to_string().contains("not found"),
                "Error should mention 'not found'"
            );
        }
    }

    #[test]
    async fn test_command_error_handling() {
        let kernel = create_test_kernel();

        // Test with a non-existent office ID
        let get_cmd = WorkspaceCommand::GetOffice {
            office_id: "non_existent_office".to_string(),
        };

        let result = kernel.process_command("admin", get_cmd);
        assert!(
            result.is_ok(),
            "Command processing should not fail even with invalid data"
        );

        if let Ok(response) = result {
            match response {
                WorkspaceResponse::Error(msg) => {
                    assert!(
                        msg.contains("not found"),
                        "Error message should contain 'not found'"
                    );
                }
                _ => panic!("Expected an error response but got something else"),
            }
        }

        // Test with a non-existent room ID
        let get_room_cmd = WorkspaceCommand::GetRoom {
            room_id: "non_existent_room".to_string(),
        };

        let room_result = kernel.process_command("admin", get_room_cmd);
        if let Ok(WorkspaceResponse::Error(msg)) = room_result {
            assert!(
                msg.contains("not found"),
                "Error message should contain 'not found'"
            );
        } else {
            panic!("Expected an error response for non-existent room");
        }
    }

    #[test]
    async fn test_room_permissions() {
        let (kernel, user_id) = create_kernel_with_user();

        // Create an office as admin
        let office = kernel
            .create_office(
                "admin",
                "Test Office".to_string(),
                "Test Description".to_string(),
            )
            .unwrap();
        let office_id = office.id.clone();

        // Add user to the office
        kernel
            .add_member(
                "admin",
                &user_id,
                Some(office_id.clone()),
                None,
                UserRole::Member,
            )
            .unwrap();

        // User should be able to create a room in the office they're a member of
        let room_result = kernel.create_room(
            &user_id,
            &office_id,
            "User Room".to_string(),
            "Created by regular user".to_string(),
        );
        assert!(
            room_result.is_ok(),
            "Member should be able to create a room in their office"
        );

        // User should not be able to delete the room (only admin or office owner can)
        if let Ok(room) = room_result {
            let delete_result = kernel.delete_room(&user_id, &room.id);
            assert!(
                delete_result.is_err(),
                "Regular member should not be able to delete a room"
            );

            if let Err(e) = delete_result {
                assert!(
                    e.to_string().contains("Permission denied"),
                    "Error should mention permission denied"
                );
            }
        }
    }
}
