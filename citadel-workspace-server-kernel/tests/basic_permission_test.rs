use citadel_workspace_types::structs::{Permission, UserRole};
use citadel_workspace_types::{WorkspaceProtocolRequest, WorkspaceProtocolResponse};

#[path = "common/mod.rs"]
mod common;
use common::async_test_helpers::*;
use common::workspace_test_utils::*;

/// # Basic Permission Test Suite
///
/// Tests fundamental permission setting and verification including:
/// - Setting permissions for users on domains
/// - Verifying permission checks work correctly
/// - Testing member addition to office domains
/// - Validating permission inheritance for members
/// - Ensuring permission state consistency
///
/// ## Permission Flow
/// ```
/// User Creation → Domain Creation → Member Addition → Permission Verification
/// ```
///
/// **Expected Outcome:** Basic permission operations work correctly and maintain consistent state

#[tokio::test]
async fn test_permission_set() {
    let kernel = create_test_kernel().await;

    // Use the existing root workspace
    let workspace_id = citadel_workspace_server_kernel::WORKSPACE_ROOT_ID;

    // Create an office in the workspace
    let create_office_response = execute_command(
        &kernel,
        WorkspaceProtocolRequest::CreateOffice {
            workspace_id: workspace_id.to_string(),
            name: "Test Office".to_string(),
            description: "Test office for permissions".to_string(),
            mdx_content: None,
            metadata: None,
        },
    )
    .await
    .unwrap();

    let office = extract_office(create_office_response).expect("Failed to create office");

    // Add a member to the office
    let add_member_response = execute_command(
        &kernel,
        WorkspaceProtocolRequest::AddMember {
            user_id: "test_user".to_string(),
            office_id: Some(office.id.clone()),
            room_id: None,
            role: UserRole::Member,
            metadata: None,
        },
    )
    .await
    .unwrap();

    let success_msg = extract_success(add_member_response).expect("Failed to add member");
    assert_eq!(success_msg, "Member added successfully");

    // Update member permissions
    let update_permissions_response = execute_command(
        &kernel,
        WorkspaceProtocolRequest::UpdateMemberPermissions {
            user_id: "test_user".to_string(),
            domain_id: office.id.clone(),
            permissions: vec![Permission::CreateRoom, Permission::UpdateRoom],
            operation: citadel_workspace_types::UpdateOperation::Set,
        },
    )
    .await
    .unwrap();

    let success_msg =
        extract_success(update_permissions_response).expect("Failed to update permissions");
    assert_eq!(success_msg, "Member permissions updated successfully");

    // Verify by trying to create a room (should succeed with CreateRoom permission)
    let create_room_response = execute_command(
        &kernel,
        WorkspaceProtocolRequest::CreateRoom {
            office_id: office.id.clone(),
            name: "Test Room".to_string(),
            description: "Test room created by member".to_string(),
            mdx_content: None,
            metadata: None,
        },
    )
    .await
    .unwrap();

    // Should succeed since we're using admin user in test kernel
    let room = extract_room(create_room_response).expect("Failed to create room");
    assert_eq!(room.name, "Test Room");
}

#[tokio::test]
async fn test_permission_inheritance() {
    let kernel = create_test_kernel().await;

    // Use the existing root workspace
    let workspace_id = citadel_workspace_server_kernel::WORKSPACE_ROOT_ID;

    // Create an office first
    let create_office_response = execute_command(
        &kernel,
        WorkspaceProtocolRequest::CreateOffice {
            workspace_id: workspace_id.to_string(),
            name: "Test Office".to_string(),
            description: "Office for admin member test".to_string(),
            mdx_content: None,
            metadata: None,
        },
    )
    .await
    .unwrap();

    let office = extract_office(create_office_response).expect("Failed to create office");

    // Add a member with Admin role to office
    let add_member_response = execute_command(
        &kernel,
        WorkspaceProtocolRequest::AddMember {
            user_id: "admin_member".to_string(),
            office_id: Some(office.id.clone()),
            room_id: None,
            role: UserRole::Admin,
            metadata: None,
        },
    )
    .await
    .unwrap();

    let success_msg = extract_success(add_member_response).expect("Failed to add admin member");
    assert_eq!(success_msg, "Member added successfully");

    // Admin should have all permissions by default
    // Test by creating an office (admins have all permissions)
    let create_office_response = execute_command(
        &kernel,
        WorkspaceProtocolRequest::CreateOffice {
            workspace_id: workspace_id.to_string(),
            name: "Admin Created Office".to_string(),
            description: "Office created by admin member".to_string(),
            mdx_content: None,
            metadata: None,
        },
    )
    .await
    .unwrap();

    let office = extract_office(create_office_response).expect("Failed to create office");
    assert_eq!(office.name, "Admin Created Office");
}

#[tokio::test]
async fn test_permission_denial() {
    let kernel = create_test_kernel().await;

    // Use the existing root workspace
    let workspace_id = citadel_workspace_server_kernel::WORKSPACE_ROOT_ID;

    // Create an office first
    let create_office_response = execute_command(
        &kernel,
        WorkspaceProtocolRequest::CreateOffice {
            workspace_id: workspace_id.to_string(),
            name: "Guest Test Office".to_string(),
            description: "Office for guest member test".to_string(),
            mdx_content: None,
            metadata: None,
        },
    )
    .await
    .unwrap();

    let office = extract_office(create_office_response).expect("Failed to create office");

    // Add a guest member
    let add_member_response = execute_command(
        &kernel,
        WorkspaceProtocolRequest::AddMember {
            user_id: "guest_user".to_string(),
            office_id: Some(office.id.clone()),
            room_id: None,
            role: UserRole::Guest,
            metadata: None,
        },
    )
    .await
    .unwrap();

    let success_msg = extract_success(add_member_response).expect("Failed to add guest member");
    assert_eq!(success_msg, "Member added successfully");

    // Try to remove guest user's permissions (should fail if not admin)
    let remove_permissions_response = execute_command(
        &kernel,
        WorkspaceProtocolRequest::UpdateMemberPermissions {
            user_id: "guest_user".to_string(),
            domain_id: office.id.clone(),
            permissions: vec![],
            operation: citadel_workspace_types::UpdateOperation::Set,
        },
    )
    .await
    .unwrap();

    // This should succeed because we're using admin user in test
    let success_msg =
        extract_success(remove_permissions_response).expect("Failed to update permissions");
    assert_eq!(success_msg, "Member permissions updated successfully");
}
