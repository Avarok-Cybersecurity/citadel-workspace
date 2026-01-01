use citadel_workspace_types::{WorkspaceProtocolRequest, WorkspaceProtocolResponse};

use common::async_test_helpers::*;
use common::workspace_test_utils::*;

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
#[tokio::test]
async fn test_room_operations() {
    let kernel = create_test_kernel().await;

    // Get the root workspace ID
    let workspace_id = citadel_workspace_server_kernel::WORKSPACE_ROOT_ID.to_string();

    // Create an office first
    let create_office_response = execute_command(
        &kernel,
        WorkspaceProtocolRequest::CreateOffice {
            workspace_id: workspace_id.clone(),
            name: "Test Office".to_string(),
            description: "A test office".to_string(),
            mdx_content: Some("# Test Office\nThis is a test office".to_string()),
            metadata: None,
            is_default: None,
        },
    )
    .await
    .unwrap();

    let office = extract_office(create_office_response).expect("Failed to create office");
    let office_id = office.id.clone();

    // Create a room in the office
    let create_room_response = execute_command(
        &kernel,
        WorkspaceProtocolRequest::CreateRoom {
            office_id: office_id.clone(),
            name: "Test Room".to_string(),
            description: "A test room".to_string(),
            mdx_content: Some("# Test Room\nThis is a test room".to_string()),
            metadata: None,
        },
    )
    .await
    .unwrap();

    let room = extract_room(create_room_response).expect("Failed to create room");
    assert_eq!(room.name, "Test Room");
    assert_eq!(room.description, "A test room");
    assert_eq!(room.mdx_content, "# Test Room\nThis is a test room");
    let room_id = room.id.clone();

    // Get the room
    let get_room_response = execute_command(
        &kernel,
        WorkspaceProtocolRequest::GetRoom {
            room_id: room_id.clone(),
        },
    )
    .await
    .unwrap();

    let retrieved_room = extract_room(get_room_response).expect("Failed to get room");
    assert_eq!(retrieved_room.name, "Test Room");
    assert_eq!(retrieved_room.description, "A test room");
    assert_eq!(
        retrieved_room.mdx_content,
        "# Test Room\nThis is a test room"
    );

    // Update the room
    let update_room_response = execute_command(
        &kernel,
        WorkspaceProtocolRequest::UpdateRoom {
            room_id: room_id.clone(),
            name: Some("Updated Room".to_string()),
            description: None,
            mdx_content: Some("# Updated Room\nThis room content has been updated".to_string()),
            metadata: None,
        },
    )
    .await
    .unwrap();

    let updated_room = extract_room(update_room_response).expect("Failed to update room");
    assert_eq!(updated_room.name, "Updated Room");
    assert_eq!(updated_room.description, "A test room");
    assert_eq!(
        updated_room.mdx_content,
        "# Updated Room\nThis room content has been updated"
    );

    // List rooms in the office
    let list_rooms_response = execute_command(
        &kernel,
        WorkspaceProtocolRequest::ListRooms {
            office_id: office_id.clone(),
        },
    )
    .await
    .unwrap();

    match list_rooms_response {
        WorkspaceProtocolResponse::Rooms(rooms) => {
            assert_eq!(rooms.len(), 1);
            assert_eq!(rooms[0].name, "Updated Room");
        }
        _ => panic!("Expected Rooms response"),
    }

    // Delete the room
    let delete_room_response = execute_command(
        &kernel,
        WorkspaceProtocolRequest::DeleteRoom {
            room_id: room_id.clone(),
        },
    )
    .await
    .unwrap();

    let success_msg = extract_success(delete_room_response).expect("Failed to delete room");
    assert_eq!(success_msg, "Room deleted successfully");

    // Verify room was deleted
    let list_rooms_after_delete = execute_command(
        &kernel,
        WorkspaceProtocolRequest::ListRooms {
            office_id: office_id.clone(),
        },
    )
    .await
    .unwrap();

    match list_rooms_after_delete {
        WorkspaceProtocolResponse::Rooms(rooms) => {
            assert_eq!(rooms.len(), 0, "Expected 0 rooms after deletion");
        }
        _ => panic!("Expected Rooms response"),
    }
}
