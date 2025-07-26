use citadel_workspace_server_kernel::handlers::domain::async_ops::AsyncPermissionOperations;
use citadel_workspace_server_kernel::WORKSPACE_ROOT_ID;
use citadel_workspace_types::structs::{Permission, User, UserRole};
use citadel_workspace_types::{WorkspaceProtocolRequest, WorkspaceProtocolResponse};

#[path = "common/mod.rs"]
mod common;
use common::async_test_helpers::*;
use common::workspace_test_utils::*;

/// # Permission Escalation Test Suite
///
/// Tests permission escalation through role upgrades including:
/// - Creating users with basic roles
/// - Adding users to domain hierarchy
/// - Upgrading user roles to admin
/// - Verifying permission escalation takes effect
/// - Testing admin-level permissions after upgrade
///
/// ## Escalation Flow
/// ```
/// User (Member: Basic Permissions) →
/// Role Upgrade (Admin) →
/// User (Admin: Management Permissions)
/// ```
///
/// **Expected Outcome:** Role upgrades grant appropriate elevated permissions

#[tokio::test]
async fn test_permission_escalation() {
    let kernel = create_test_kernel().await;

    // Create a regular user
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
        WorkspaceProtocolRequest::CreateOffice {
            workspace_id: WORKSPACE_ROOT_ID.to_string(),
            name: "Test Office".to_string(),
            description: "For Testing".to_string(),
            mdx_content: None,
            metadata: None,
        },
    )
    .await;

    let office_id = match office_result {
        Ok(WorkspaceProtocolResponse::Office(office)) => office.id,
        _ => panic!("Expected Office response, got {:?}", office_result),
    };

    // Create a room in the office
    let room_result = execute_command(
        &kernel,
        WorkspaceProtocolRequest::CreateRoom {
            office_id: office_id.clone(),
            name: "Test Room".to_string(),
            description: "Room for testing".to_string(),
            mdx_content: None,
            metadata: None,
        },
    )
    .await;

    let room_id = match room_result {
        Ok(WorkspaceProtocolResponse::Room(room)) => room.id,
        _ => panic!("Expected Room response, got {:?}", room_result),
    };

    // Add user to both office and room
    let add_office_result = execute_command(
        &kernel,
        WorkspaceProtocolRequest::AddMember {
            user_id: user_id.to_string(),
            office_id: Some(office_id.clone()),
            room_id: None,
            role: UserRole::Member,
            metadata: None,
        },
    )
    .await;
    assert!(add_office_result.is_ok());

    let add_room_result = execute_command(
        &kernel,
        WorkspaceProtocolRequest::AddMember {
            user_id: user_id.to_string(),
            office_id: Some(office_id.clone()),
            room_id: Some(room_id.clone()),
            role: UserRole::Member,
            metadata: None,
        },
    )
    .await;
    assert!(add_room_result.is_ok());

    // Check basic permission
    let has_view_permission = kernel
        .domain_operations
        .check_entity_permission(user_id, &room_id, Permission::ViewContent)
        .await
        .unwrap();
    assert!(
        has_view_permission,
        "User should have view permission on room"
    );

    // Upgrade user to room admin via role
    let mut user_from_db = kernel
        .domain_operations
        .backend_tx_manager
        .get_user(user_id)
        .await
        .unwrap()
        .expect("User should exist");

    user_from_db.role = UserRole::Admin;
    kernel
        .domain_operations
        .backend_tx_manager
        .update_user(user_id, user_from_db)
        .await
        .unwrap();

    // Now user should have admin permissions
    let has_admin_permission = kernel
        .domain_operations
        .check_entity_permission(user_id, &room_id, Permission::ManageRoomMembers)
        .await
        .unwrap();
    assert!(
        has_admin_permission,
        "User should have admin permission after role upgrade"
    );
}
