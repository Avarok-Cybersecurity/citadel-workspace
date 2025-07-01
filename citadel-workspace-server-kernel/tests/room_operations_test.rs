use citadel_workspace_server_kernel::WORKSPACE_ROOT_ID;
use citadel_workspace_types::{WorkspaceProtocolRequest, WorkspaceProtocolResponse};
use rstest::*;
use std::time::Duration;

mod common;
use common::integration_test_utils::*;

/// # Room Operations Integration Test
///
/// Tests comprehensive room CRUD operations including:
/// - Creating offices as prerequisites for rooms
/// - Creating rooms within offices
/// - Retrieving room details
/// - Updating room properties (name, description, mdx_content)
/// - Listing rooms within an office
/// - Deleting rooms and verification
///
/// ## Test Workflow
/// ```
/// Setup Environment → Connect Admin → Create Office →
/// Create Room → Get Room → Update Room → List Rooms →
/// Delete Room → Verify Deletion
/// ```
///
/// **Expected Outcome:** All room operations succeed with proper office hierarchy
#[rstest]
#[tokio::test]
#[timeout(Duration::from_secs(15))]
async fn test_room_operations() {
    println!("Setting up test environment...");
    let (_kernel, internal_service_addr, server_addr, admin_username, admin_password, _db_temp_dir) =
        setup_test_environment().await.unwrap();
    println!("Test environment setup complete.");

    println!("Registering and connecting admin user...");
    // Use admin credentials to connect
    let (to_service, mut from_service, admin_cid) = register_and_connect_user(
        internal_service_addr,
        server_addr,
        &admin_username,
        &admin_password,
    )
    .await
    .unwrap();

    println!("Admin user registered and connected with CID: {admin_cid}.");

    // The root workspace is created during `setup_test_environment`, so we don't need to create it again.
    // We can directly use WORKSPACE_ROOT_ID for further operations.
    let actual_workspace_id = WORKSPACE_ROOT_ID.to_string();
    println!(
        "Using pre-existing root workspace with ID: {}",
        actual_workspace_id
    );

    // Create an office using the command processor instead of directly
    println!("Creating test office...");
    let create_office_cmd = WorkspaceProtocolRequest::CreateOffice {
        workspace_id: actual_workspace_id.clone(), // Use the extracted workspace ID
        name: "Test Office".to_string(),
        description: "A test office".to_string(),
        mdx_content: Some("# Test Office\nThis is a test office".to_string()),
        metadata: None,
    };

    let response =
        send_workspace_command(&to_service, &mut from_service, admin_cid, create_office_cmd)
            .await
            .unwrap();

    let office_id = match response {
        WorkspaceProtocolResponse::Office(office) => {
            println!("Created office: {:?}", office);
            office.id
        }
        _ => panic!("Expected Office response"),
    };

    println!("Test office created.");

    println!("Creating test room...");
    let create_room_cmd = WorkspaceProtocolRequest::CreateRoom {
        office_id: office_id.clone(),
        name: "Test Room".to_string(),
        description: "A test room".to_string(),
        mdx_content: Some("# Test Room\nThis is a test room".to_string()),
        metadata: None,
    };

    let response =
        send_workspace_command(&to_service, &mut from_service, admin_cid, create_room_cmd)
            .await
            .unwrap();
    let room_id = match response {
        WorkspaceProtocolResponse::Room(room) => {
            assert_eq!(room.name, "Test Room");
            assert_eq!(room.description, "A test room");
            assert_eq!(room.mdx_content, "# Test Room\nThis is a test room");
            room.id.clone()
        }
        _ => panic!("Expected Room response"),
    };

    println!("Test room created.");

    println!("Getting test room...");
    let get_room_cmd = WorkspaceProtocolRequest::GetRoom {
        room_id: room_id.clone(),
    };

    let response = send_workspace_command(&to_service, &mut from_service, admin_cid, get_room_cmd)
        .await
        .unwrap();

    match response {
        WorkspaceProtocolResponse::Room(room) => {
            assert_eq!(room.name, "Test Room");
            assert_eq!(room.description, "A test room");
            assert_eq!(room.mdx_content, "# Test Room\nThis is a test room");
        }
        _ => panic!("Expected Room response"),
    }

    println!("Test room retrieved.");

    println!("Updating test room...");
    let update_room_cmd = WorkspaceProtocolRequest::UpdateRoom {
        room_id: room_id.clone(),
        name: Some("Updated Room".to_string()),
        description: None,
        mdx_content: Some("# Updated Room\nThis room content has been updated".to_string()),
        metadata: None,
    };

    let response =
        send_workspace_command(&to_service, &mut from_service, admin_cid, update_room_cmd)
            .await
            .unwrap();

    match response {
        WorkspaceProtocolResponse::Room(room) => {
            assert_eq!(room.name, "Updated Room");
            assert_eq!(room.description, "A test room");
            assert_eq!(
                room.mdx_content,
                "# Updated Room\nThis room content has been updated"
            );
        }
        _ => panic!("Expected Room response"),
    }

    println!("Test room updated.");

    println!("Listing rooms...");
    let list_rooms_cmd = WorkspaceProtocolRequest::ListRooms {
        office_id: office_id.clone(),
    };

    let response =
        send_workspace_command(&to_service, &mut from_service, admin_cid, list_rooms_cmd)
            .await
            .unwrap();

    match response {
        WorkspaceProtocolResponse::Rooms(rooms) => {
            assert_eq!(rooms.len(), 1);
            assert_eq!(rooms[0].name, "Updated Room");
        }
        _ => panic!("Expected Rooms response"),
    }

    println!("Rooms listed.");

    println!("Deleting test room...");
    let delete_room_cmd = WorkspaceProtocolRequest::DeleteRoom { room_id };

    let response =
        send_workspace_command(&to_service, &mut from_service, admin_cid, delete_room_cmd)
            .await
            .unwrap();

    match response {
        WorkspaceProtocolResponse::Success(_) => {}
        _ => panic!("Expected Success response"),
    }

    println!("Test room deleted.");

    println!("Verifying room was deleted...");
    let list_rooms_cmd = WorkspaceProtocolRequest::ListRooms { office_id };

    let response =
        send_workspace_command(&to_service, &mut from_service, admin_cid, list_rooms_cmd)
            .await
            .unwrap();

    match response {
        WorkspaceProtocolResponse::Rooms(rooms) => {
            assert_eq!(rooms.len(), 0);
        }
        _ => panic!("Expected Rooms response"),
    }

    println!("Test complete.");
}
