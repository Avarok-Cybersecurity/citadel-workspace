use citadel_logging::debug;
use citadel_workspace_server_kernel::handlers::domain::async_ops::AsyncPermissionOperations;
use citadel_workspace_server_kernel::WORKSPACE_ROOT_ID;
use citadel_workspace_types::structs::{NodeEntityType, Permission, User, UserRole};
use citadel_workspace_types::{WorkspaceProtocolRequest, WorkspaceProtocolResponse};

use common::async_test_helpers::*;
use common::workspace_test_utils::*;

/// # Office-Room Permission Inheritance Test Suite
///
/// Tests hierarchical permission inheritance from office to room including:
/// - Creating office and room hierarchy
/// - Adding users to office (parent) but not room (child)
/// - Verifying permission inheritance from office to room
/// - Testing view permission inheritance
/// - Ensuring inappropriate permissions are not inherited
///
/// ## Permission Inheritance Flow
/// ```
/// Office (Member: ViewContent) →
/// Room (Inherited: ViewContent from office membership)
/// ```
///
/// **Expected Outcome:** Users in parent office inherit appropriate permissions in child rooms

#[tokio::test]
async fn test_office_room_permission_inheritance() {
    let kernel = create_test_kernel().await;

    // Create test users with different roles
    let user_id = "test_user";
    let user = User::new(
        user_id.to_string(),
        "Test User".to_string(),
        UserRole::Member,
    );

    // Insert the user
    kernel
        .domain_operations
        .backend_tx_manager
        .insert_user(user_id.to_string(), user)
        .await
        .unwrap();

    // Create an office
    let office_result = execute_command(
        &kernel,
        WorkspaceProtocolRequest::CreateNode {
            parent_id: Some(WORKSPACE_ROOT_ID.to_string()),
            entity_type: NodeEntityType::Child("Office".to_string()),
            name: "Test Office".to_string(),
            description: "For Testing".to_string(),
        },
    )
    .await;

    let office_id = match office_result {
        Ok(WorkspaceProtocolResponse::Node(node)) => node.id,
        _ => panic!("Expected Node response, got {:?}", office_result),
    };

    // Create a room in the office
    let room_result = execute_command(
        &kernel,
        WorkspaceProtocolRequest::CreateNode {
            parent_id: Some(office_id.clone()),
            entity_type: NodeEntityType::Child("Room".to_string()),
            name: "Test Room".to_string(),
            description: "Room for testing".to_string(),
        },
    )
    .await;

    let room_id = match room_result {
        Ok(WorkspaceProtocolResponse::Node(node)) => node.id,
        _ => panic!("Expected Node response, got {:?}", room_result),
    };

    // Add the user to the office but not the room
    let add_result = execute_command(
        &kernel,
        WorkspaceProtocolRequest::AddMember {
            user_id: user_id.to_string(),
            domain_id: Some(office_id.clone()),
            role: UserRole::Member,
            metadata: None,
        },
    )
    .await;
    assert!(add_result.is_ok());

    // Verify the user is in the office
    let node = kernel
        .domain_operations
        .backend_tx_manager
        .get_node(&office_id)
        .await
        .unwrap()
        .expect("Office node should exist");

    let office_id_for_check = office_id.clone();
    debug!(
        "[TEST_DEBUG] Created office 'OfficeInWsPermTest' with ID: {} in workspace_id: {}",
        office_id_for_check, WORKSPACE_ROOT_ID
    );

    let user_in_node = node.members.contains(&user_id.to_string());
    assert!(
        user_in_node,
        "User should be in the office members list"
    );

    // Check permission inheritance - user should have view access to the room
    // because they are a member of the parent office
    let has_room_access = kernel
        .domain_operations
        .is_member_of_domain(user_id, &room_id)
        .await
        .unwrap();
    assert!(
        has_room_access,
        "User should have access to room because they're members of the parent office"
    );

    // Check view permission inheritance
    let has_view_permission = kernel
        .domain_operations
        .check_entity_permission(user_id, &room_id, Permission::ViewContent)
        .await
        .unwrap();
    assert!(
        has_view_permission,
        "User should inherit view permission on room from parent office"
    );

    // User shouldn't have edit permission on the room (Members don't have EditContent)
    let has_edit_permission = kernel
        .domain_operations
        .check_entity_permission(user_id, &room_id, Permission::EditContent)
        .await
        .unwrap();
    assert!(
        !has_edit_permission,
        "User shouldn't have EditContent permission on room"
    );
}
