use citadel_workspace_types::structs::UserRole;
use citadel_workspace_types::{WorkspaceProtocolRequest, WorkspaceProtocolResponse};

#[path = "common/mod.rs"]
mod common;
use common::async_test_helpers::*;
use common::workspace_test_utils::*;

#[tokio::test]
async fn test_member_operations() {
    let kernel = create_test_kernel().await;

    // Get the root workspace ID
    let workspace_id = citadel_workspace_server_kernel::WORKSPACE_ROOT_ID.to_string();

    // Create a regular user by adding them to the backend
    use citadel_workspace_types::structs::User;
    let test_user = User::new(
        "test_user".to_string(),
        "Test User".to_string(),
        UserRole::Member,
    );

    kernel
        .domain_operations
        .backend_tx_manager
        .insert_user("test_user".to_string(), test_user)
        .await
        .expect("Failed to insert test user");

    // Add the user to the workspace first so they remain a workspace member after office removal
    let add_workspace_member_response = execute_command(
        &kernel,
        WorkspaceProtocolRequest::AddMember {
            user_id: "test_user".to_string(),
            office_id: None,
            room_id: None,
            role: UserRole::Member,
            metadata: Some("workspace_metadata".to_string().into_bytes()),
        },
    )
    .await
    .unwrap();

    let success_msg = extract_success(add_workspace_member_response)
        .expect("Failed to add test user to workspace");
    assert_eq!(success_msg, "Member added successfully");

    // Create an office
    let create_office_response = execute_command(
        &kernel,
        WorkspaceProtocolRequest::CreateOffice {
            workspace_id: workspace_id.clone(),
            name: "Test Office".to_string(),
            description: "A test office".to_string(),
            mdx_content: None,
            metadata: None,
        },
    )
    .await
    .unwrap();

    let office = extract_office(create_office_response).expect("Failed to create office");
    let office_id = office.id.clone();

    // Create a room
    let create_room_response = execute_command(
        &kernel,
        WorkspaceProtocolRequest::CreateRoom {
            office_id: office_id.clone(),
            name: "Test Room".to_string(),
            description: "A test room".to_string(),
            mdx_content: None,
            metadata: None,
        },
    )
    .await
    .unwrap();

    let room = extract_room(create_room_response).expect("Failed to create room");
    let room_id = room.id.clone();

    // Add test user to office
    let add_office_member_response = execute_command(
        &kernel,
        WorkspaceProtocolRequest::AddMember {
            user_id: "test_user".to_string(),
            office_id: Some(office_id.clone()),
            room_id: None,
            role: UserRole::Member,
            metadata: Some("test_metadata".to_string().into_bytes()),
        },
    )
    .await
    .unwrap();

    let success_msg =
        extract_success(add_office_member_response).expect("Failed to add test user to office");
    assert_eq!(success_msg, "Member added successfully");

    // Update member permissions
    use citadel_workspace_types::structs::Permission;
    use citadel_workspace_types::UpdateOperation;
    let update_permissions_response = execute_command(
        &kernel,
        WorkspaceProtocolRequest::UpdateMemberPermissions {
            user_id: "test_user".to_string(),
            domain_id: office_id.clone(),
            permissions: vec![Permission::ViewContent],
            operation: UpdateOperation::Add,
        },
    )
    .await
    .unwrap();

    let success_msg =
        extract_success(update_permissions_response).expect("Failed to update member permissions");
    assert_eq!(success_msg, "Member permissions updated successfully");

    // Get member to verify they're in office
    let get_member_response = execute_command(
        &kernel,
        WorkspaceProtocolRequest::GetMember {
            user_id: "test_user".to_string(),
        },
    )
    .await
    .unwrap();

    match get_member_response {
        WorkspaceProtocolResponse::Member(member) => {
            assert_eq!(member.id, "test_user");
            assert!(member.is_member_of_domain(office_id.clone()));
            assert_eq!(member.role, UserRole::Member);
        }
        _ => panic!("Expected Member response"),
    }

    // Add test user to room
    let add_room_member_response = execute_command(
        &kernel,
        WorkspaceProtocolRequest::AddMember {
            user_id: "test_user".to_string(),
            office_id: None,
            room_id: Some(room_id.clone()),
            role: UserRole::Member,
            metadata: Some("test_metadata".to_string().into_bytes()),
        },
    )
    .await
    .unwrap();

    let success_msg =
        extract_success(add_room_member_response).expect("Failed to add test user to room");
    assert_eq!(success_msg, "Member added successfully");

    // Verify test user is in room
    let get_room_response = execute_command(
        &kernel,
        WorkspaceProtocolRequest::GetRoom {
            room_id: room_id.clone(),
        },
    )
    .await
    .unwrap();

    let room = extract_room(get_room_response).expect("Failed to get room");
    assert!(
        room.members.contains(&"test_user".to_string()),
        "Test user should be in room"
    );

    // Remove test user from room
    let remove_room_member_response = execute_command(
        &kernel,
        WorkspaceProtocolRequest::RemoveMember {
            user_id: "test_user".to_string(),
            office_id: None,
            room_id: Some(room_id.clone()),
        },
    )
    .await
    .unwrap();

    let success_msg =
        extract_success(remove_room_member_response).expect("Failed to remove test user from room");
    assert_eq!(success_msg, "Member removed successfully");

    // Verify test user is no longer in room
    let get_room_response = execute_command(
        &kernel,
        WorkspaceProtocolRequest::GetRoom {
            room_id: room_id.clone(),
        },
    )
    .await
    .unwrap();

    let room = extract_room(get_room_response).expect("Failed to get room");
    assert!(
        !room.members.contains(&"test_user".to_string()),
        "Test user should not be in room"
    );

    // Remove test user from office
    let remove_office_member_response = execute_command(
        &kernel,
        WorkspaceProtocolRequest::RemoveMember {
            user_id: "test_user".to_string(),
            office_id: Some(office_id.clone()),
            room_id: None,
        },
    )
    .await
    .unwrap();

    let success_msg = extract_success(remove_office_member_response)
        .expect("Failed to remove test user from office");
    assert_eq!(success_msg, "Member removed successfully");

    // Verify test user is no longer in office
    let get_member_response = execute_command(
        &kernel,
        WorkspaceProtocolRequest::GetMember {
            user_id: "test_user".to_string(),
        },
    )
    .await
    .unwrap();

    match get_member_response {
        WorkspaceProtocolResponse::Member(member) => {
            assert_eq!(member.id, "test_user");
            assert!(
                !member.is_member_of_domain(&office_id),
                "Test user should not be in office"
            );
        }
        _ => panic!("Expected Member response"),
    }

    // Verify removed user cannot get office details (since they're no longer a member)
    use citadel_workspace_server_kernel::handlers::domain::async_ops::AsyncOfficeOperations;
    let office_result = kernel
        .domain_operations
        .get_office("test_user", &office_id)
        .await;
    assert!(
        office_result.is_err(),
        "Expected get_office to fail for non-member, but got: {:?}",
        office_result
    );
}
