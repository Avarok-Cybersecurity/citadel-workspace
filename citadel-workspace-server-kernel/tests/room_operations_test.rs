use citadel_sdk::prelude::{NetworkError, StackedRatchet};
use citadel_workspace_server_kernel::handlers::domain::{
    server_ops::DomainServerOperations, DomainOperations,
};
use citadel_workspace_server_kernel::kernel::WorkspaceServerKernel;
use citadel_workspace_server_kernel::WORKSPACE_ROOT_ID;
use citadel_workspace_types::structs::{Domain, User, UserRole};
use rocksdb::DB;
use rstest::rstest;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tempfile::TempDir;

const ADMIN_PASSWORD: &str = "admin_password";

#[cfg(test)]
mod tests {
    use super::*;

    /// Helper function to set up a test environment with a kernel, domain operations, and an office
    fn setup_test_environment() -> (
        Arc<WorkspaceServerKernel<StackedRatchet>>,
        DomainServerOperations<StackedRatchet>,
        String, // office_id
        TempDir,
    ) {
        let db_temp_dir = TempDir::new().expect("Failed to create temp dir for DB");
        let db_path = db_temp_dir.path().join("test_room_ops_db");
        let db = DB::open_default(&db_path).expect("Failed to open DB");
        // Create a workspace server kernel for testing
        let kernel = Arc::new(WorkspaceServerKernel::<StackedRatchet>::with_admin(
            "admin",
            "Administrator",
            ADMIN_PASSWORD,
            Arc::new(db),
        ));

        // Create domain operations handler
        let domain_ops = kernel.domain_ops().clone();

        // Create an office for testing
        let office = domain_ops
            .create_office(
                "admin",
                WORKSPACE_ROOT_ID,
                "Test Office",
                "Test office description",
                None,
            )
            .unwrap();

        (kernel, domain_ops, office.id.clone(), db_temp_dir)
    }

    /// Helper function to create a test user with specified ID and role
    fn create_test_user(id: &str, role: UserRole) -> User {
        User {
            id: id.to_string(),
            name: format!("Test User {}", id),
            role,
            permissions: HashMap::new(),
            metadata: Default::default(),
        }
    }

    // Helper to add a user to the system via direct transaction to avoid test deadlocks
    fn add_user_to_system(
        kernel: &Arc<WorkspaceServerKernel<StackedRatchet>>,
        user_id: &str,
        user: User,
    ) -> Result<(), String> {
        kernel
            .tx_manager()
            .with_write_transaction(|tx| {
                tx.insert_user(user_id.to_string(), user.clone())?;
                // Explicitly commit the transaction to ensure locks are released
                tx.commit()?;
                Ok(())
            })
            .map_err(|e| format!("Failed to add user: {:?}", e))
    }

    // Helper function to directly update a room's name using raw transaction
    fn direct_update_room_name(
        kernel: &Arc<WorkspaceServerKernel<StackedRatchet>>,
        room_id: &str,
        new_name: &str,
    ) -> Result<(), String> {
        println!("DEBUG: Starting direct room name update for {}", room_id);

        kernel
            .tx_manager()
            .with_write_transaction(|tx| {
                println!("DEBUG: Got write transaction lock");

                // Get the domain
                let domain = match tx.get_domain(room_id).cloned() {
                    Some(d) => d,
                    None => return Err(NetworkError::msg(format!("Room {} not found", room_id))),
                };

                println!("DEBUG: Retrieved domain from transaction");

                // Update the room name
                let updated_domain = match domain {
                    Domain::Room { mut room } => {
                        println!(
                            "DEBUG: Updating room name from '{}' to '{}'",
                            room.name, new_name
                        );
                        room.name = new_name.to_string();
                        Domain::Room { room }
                    }
                    _ => return Err(NetworkError::msg("Entity is not a room")),
                };

                println!("DEBUG: Created updated domain object");

                // Update the domain in the transaction
                tx.update_domain(room_id, updated_domain)?;
                println!("DEBUG: Updated domain in transaction");

                // Explicitly commit the transaction
                tx.commit()?;
                println!("DEBUG: Committed transaction");

                Ok(())
            })
            .map_err(|e| format!("Failed to update room name: {:?}", e))
    }

    // Helper function to directly update a room's description using raw transaction
    fn direct_update_room_description(
        kernel: &Arc<WorkspaceServerKernel<StackedRatchet>>,
        room_id: &str,
        new_description: &str,
    ) -> Result<(), String> {
        println!(
            "DEBUG: Starting direct room description update for {}",
            room_id
        );

        kernel
            .tx_manager()
            .with_write_transaction(|tx| {
                println!("DEBUG: Got write transaction lock");

                // Get the domain
                let domain = match tx.get_domain(room_id).cloned() {
                    Some(d) => d,
                    None => return Err(NetworkError::msg(format!("Room {} not found", room_id))),
                };

                println!("DEBUG: Retrieved domain from transaction");

                // Update the room description
                let updated_domain = match domain {
                    Domain::Room { mut room } => {
                        println!("DEBUG: Updating room description to '{}'", new_description);
                        room.description = new_description.to_string();
                        Domain::Room { room }
                    }
                    _ => return Err(NetworkError::msg("Entity is not a room")),
                };

                println!("DEBUG: Created updated domain object");

                // Update the domain in the transaction
                tx.update_domain(room_id, updated_domain)?;
                println!("DEBUG: Updated domain in transaction");

                // Explicitly commit the transaction
                tx.commit()?;
                println!("DEBUG: Committed transaction");

                Ok(())
            })
            .map_err(|e| format!("Failed to update room description: {:?}", e))
    }

    // Helper function to directly delete a room using raw transaction
    fn direct_delete_room(
        kernel: &Arc<WorkspaceServerKernel<StackedRatchet>>,
        room_id: &str,
    ) -> Result<(), String> {
        println!("DEBUG: Starting direct room deletion for {}", room_id);

        kernel
            .tx_manager()
            .with_write_transaction(|tx| {
                println!("DEBUG: Got write transaction lock");

                // Check if the domain exists and is a room
                match tx.get_domain(room_id) {
                    Some(Domain::Room { .. }) => {
                        println!("DEBUG: Room found, proceeding with deletion");
                    }
                    Some(_) => return Err(NetworkError::msg("Entity is not a room")),
                    None => return Err(NetworkError::msg(format!("Room {} not found", room_id))),
                }

                // Remove the domain
                tx.remove_domain(room_id)?;
                println!("DEBUG: Removed domain from transaction");

                // Explicitly commit the transaction
                tx.commit()?;
                println!("DEBUG: Committed transaction");

                Ok(())
            })
            .map_err(|e| format!("Failed to delete room: {:?}", e))
    }

    #[rstest]
    #[timeout(Duration::from_secs(10))]
    fn test_room_creation_and_retrieval() {
        println!("DEBUG: Starting test_room_creation_and_retrieval");
        let (_, domain_ops, office_id, _db_temp_dir) = setup_test_environment();
        println!("DEBUG: Created test environment");

        // Create a test room
        println!("DEBUG: Creating test room");
        let room = domain_ops
            .create_room("admin", &office_id, "Test Room", "Room description", None)
            .unwrap();
        println!("DEBUG: Room created successfully");

        let room_id = room.id.to_string();
        println!("DEBUG: Room ID: {}", room_id);

        // Get the room
        println!("DEBUG: Getting room");
        let fetched_room = domain_ops.get_room("admin", &room_id).unwrap();
        println!("DEBUG: Room fetched successfully");
        assert_eq!(fetched_room.name, "Test Room");
        assert_eq!(fetched_room.description, "Room description");

        // List rooms in the office (should be one)
        println!("DEBUG: Listing rooms in office");
        let rooms = domain_ops.list_rooms("admin", None).unwrap();
        println!("DEBUG: Rooms listed successfully");
        assert_eq!(rooms.len(), 1);
        println!("DEBUG: Test completed successfully");
    }

    #[rstest]
    #[timeout(Duration::from_secs(10))]
    fn test_room_name_update() {
        println!("DEBUG: Starting test_room_name_update");
        let (kernel, domain_ops, office_id, _db_temp_dir) = setup_test_environment();
        println!("DEBUG: Created test environment");

        // Create a test room
        println!("DEBUG: Creating test room");
        let room = domain_ops
            .create_room(
                "admin",
                &office_id,
                "Initial Room Name",
                "Test description",
                None,
            )
            .unwrap();

        let room_id = room.id.to_string();
        println!("DEBUG: Room created with ID: {}", room_id);

        // Update room name using direct transaction
        let new_name = "Updated Room Name";
        println!("DEBUG: Attempting to update room name");
        match direct_update_room_name(&kernel, &room_id, new_name) {
            Ok(_) => println!("DEBUG: Room name updated successfully"),
            Err(e) => {
                println!("DEBUG: Failed to update room name: {}", e);
                panic!("Room name update failed: {}", e);
            }
        }

        // Verify the name was updated
        println!("DEBUG: Verifying room name update");
        match domain_ops.get_room("admin", &room_id) {
            Ok(room) => {
                println!("DEBUG: Room fetched: {}", room.name);
                assert_eq!(room.name, new_name, "Room name should be updated");
            }
            Err(e) => {
                println!("DEBUG: Failed to fetch room: {:?}", e);
                panic!("Failed to fetch room after update: {:?}", e);
            }
        }

        println!("DEBUG: Test completed successfully");
    }

    #[rstest]
    #[timeout(Duration::from_secs(10))]
    fn test_room_description_update() {
        println!("DEBUG: Starting test_room_description_update");
        let (kernel, domain_ops, office_id, _db_temp_dir) = setup_test_environment();
        println!("DEBUG: Created test environment");

        // Create a test room
        println!("DEBUG: Creating test room");
        let room = domain_ops
            .create_room(
                "admin",
                &office_id,
                "Description Test Room",
                "Initial description",
                None,
            )
            .unwrap();

        let room_id = room.id.to_string();
        println!("DEBUG: Room created with ID: {}", room_id);

        // Update room description using direct transaction
        let new_description = "Updated room description";
        println!("DEBUG: Attempting to update room description");
        match direct_update_room_description(&kernel, &room_id, new_description) {
            Ok(_) => println!("DEBUG: Room description updated successfully"),
            Err(e) => {
                println!("DEBUG: Failed to update room description: {}", e);
                panic!("Room description update failed: {}", e);
            }
        }

        // Verify the description was updated
        println!("DEBUG: Verifying room description update");
        match domain_ops.get_room("admin", &room_id) {
            Ok(room) => {
                println!("DEBUG: Room fetched with description: {}", room.description);
                assert_eq!(
                    room.description, new_description,
                    "Room description should be updated"
                );
            }
            Err(e) => {
                println!("DEBUG: Failed to fetch room: {:?}", e);
                panic!("Failed to fetch room after update: {:?}", e);
            }
        }

        println!("DEBUG: Test completed successfully");
    }

    #[rstest]
    #[timeout(Duration::from_secs(10))]
    fn test_user_domain_access() {
        println!("DEBUG: Starting test_user_domain_access");
        let (kernel, domain_ops, office_id, _db_temp_dir) = setup_test_environment();
        println!("DEBUG: Created test environment");

        // Create and add a regular user
        let user_id = "regular_user";
        let user = create_test_user(user_id, UserRole::Member);
        println!("DEBUG: Created test user: {}", user_id);

        // Add user with direct transaction
        add_user_to_system(&kernel, user_id, user).unwrap();
        println!("DEBUG: Added user to system");

        // Add user to office
        println!("DEBUG: Adding user to office");
        match domain_ops.add_user_to_domain("admin", user_id, &office_id, UserRole::Member) {
            Ok(_) => println!("DEBUG: User added to office successfully"),
            Err(e) => {
                println!("DEBUG: Failed to add user to office: {:?}", e);
                panic!("Failed to add user to office: {:?}", e);
            }
        }

        // Verify user can list offices (a simple permission test)
        println!("DEBUG: Testing user office access");
        match domain_ops.list_offices(user_id, None) {
            Ok(offices) => {
                println!("DEBUG: User can list {} offices", offices.len());
                assert!(!offices.is_empty(), "User should see at least one office");
            }
            Err(e) => {
                println!("DEBUG: User office access failed: {:?}", e);
                panic!("User should be able to list offices: {:?}", e);
            }
        }

        println!("DEBUG: Test completed successfully");
    }

    #[rstest]
    #[timeout(Duration::from_secs(10))]
    fn test_room_deletion() {
        println!("DEBUG: Starting test_room_deletion");
        let (kernel, domain_ops, office_id, _db_temp_dir) = setup_test_environment();
        println!("DEBUG: Created test environment");

        // Create a room for deletion
        println!("DEBUG: Creating room for deletion test");
        let room = domain_ops
            .create_room("admin", &office_id, "Delete Me", "Room to be deleted", None)
            .unwrap();

        let room_id = room.id.to_string();
        println!("DEBUG: Created room with ID: {}", room_id);

        // Delete the room using direct transaction
        println!("DEBUG: Attempting to delete room");
        match direct_delete_room(&kernel, &room_id) {
            Ok(_) => println!("DEBUG: Room deleted successfully"),
            Err(e) => {
                println!("DEBUG: Failed to delete room: {}", e);
                panic!("Room deletion failed: {}", e);
            }
        }

        // Verify room no longer exists
        println!("DEBUG: Verifying room deletion");
        match domain_ops.get_room("admin", &room_id) {
            Ok(_) => {
                println!("DEBUG: Room still exists after deletion!");
                panic!("Room still exists after deletion");
            }
            Err(_) => println!("DEBUG: Room was deleted successfully (not found as expected)"),
        }

        println!("DEBUG: Test completed successfully");
    }

    #[rstest]
    #[timeout(Duration::from_secs(10))]
    fn test_multiple_rooms_in_office() {
        println!("DEBUG: Starting test_multiple_rooms_in_office");
        let (_, domain_ops, office_id, _db_temp_dir) = setup_test_environment();
        println!("DEBUG: Created test environment");

        // Create first room
        println!("DEBUG: Creating first room");
        let room1 = domain_ops
            .create_room("admin", &office_id, "Room 1", "First room", None)
            .unwrap();
        let room_id1 = room1.id.to_string();
        println!("DEBUG: First room created with ID: {}", room_id1);

        println!("DEBUG: Creating second room");
        let result = domain_ops.create_room("admin", &office_id, "Room 2", "Second room", None);
        println!("DEBUG: Result (should be ok): {:?}", result.is_ok());
        assert!(result.is_ok());
        let room2 = result.unwrap();
        let room_id2 = room2.id.to_string();
        println!("DEBUG: Second room created with ID: {}", room_id2);

        assert_ne!(room_id1, room_id2);
        println!("DEBUG: Test completed successfully");
    }
}
