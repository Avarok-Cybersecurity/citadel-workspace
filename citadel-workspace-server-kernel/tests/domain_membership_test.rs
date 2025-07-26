use citadel_logging::info;
use citadel_workspace_server_kernel::handlers::domain::async_ops::AsyncPermissionOperations;
use citadel_workspace_server_kernel::WORKSPACE_ROOT_ID;
use citadel_workspace_types::structs::{User, UserRole};
use citadel_workspace_types::{WorkspaceProtocolRequest, WorkspaceProtocolResponse};

#[path = "common/mod.rs"]
mod common;
use common::async_test_helpers::*;
use common::workspace_test_utils::*;

/// # Domain Membership Behavior Test Suite
///
/// Tests domain membership behavior and inheritance patterns including:
/// - Verifying initial non-membership of users
/// - Adding users to office domains
/// - Testing implicit room membership through office membership
/// - Verifying inheritance-based domain access
/// - Ensuring proper membership cascade behavior
///
/// ## Membership Inheritance Flow
/// ```
/// User (Not Member) →
/// Add to Office (Explicit Member) →
/// Room Access (Implicit Member via inheritance)
/// ```
///
/// **Expected Outcome:** Domain membership properly cascades through hierarchy

#[tokio::test]
async fn test_is_member_of_domain_behavior() {
    let kernel = create_test_kernel().await;

    // Create test users
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

    let actual_workspace_id = WORKSPACE_ROOT_ID.to_string();
    info!(target: "citadel", "Using existing workspace for test_is_member_of_domain_behavior: {}", actual_workspace_id);

    // Admin should already have All permissions on actual_workspace_id (WORKSPACE_ROOT_ID) via setup_test_environment

    // Create an office
    let office_result = execute_command(
        &kernel,
        WorkspaceProtocolRequest::CreateOffice {
            workspace_id: actual_workspace_id.clone(),
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

    // Initially user is not a member of any domain
    let is_member_office = kernel
        .domain_operations
        .is_member_of_domain(user_id, &office_id)
        .await
        .unwrap();
    assert!(
        !is_member_office,
        "User should not be member of office initially"
    );
    // CASCADE DEBUG: Check workspace members before checking room membership (initial check)
    let current_workspace_id_for_debug = actual_workspace_id.to_string();
    let user_id_for_debug = user_id.to_string();
    let workspace_members_before_room_check = {
        let ws = kernel
            .domain_operations
            .backend_tx_manager
            .get_workspace(&current_workspace_id_for_debug)
            .await
            .expect("Workspace should exist for debug check")
            .expect("Workspace should be Some");
        println!(
            "CASCADE_TEST_DEBUG: Workspace ({}) members before initial room membership check for user '{}': {:?}",
            current_workspace_id_for_debug, user_id_for_debug, ws.members
        );
        ws.members.clone()
    };

    assert!(
        !workspace_members_before_room_check.contains(&user_id_for_debug.to_string()),
        "CRITICAL_ASSERT: test_user ({}) should NOT be in workspace ({}) members list before initial room check. Members: {:?}",
        user_id_for_debug, current_workspace_id_for_debug, workspace_members_before_room_check
    );

    // Original check that was failing
    let is_member_room = kernel
        .domain_operations
        .is_member_of_domain(user_id, &room_id)
        .await
        .unwrap();
    assert!(
        !is_member_room,
        "User should not be member of room initially"
    );

    // Add user to the office only
    let add_result = execute_command(
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
    assert!(add_result.is_ok());

    // Now user should be a member of the office
    let is_member_office = kernel
        .domain_operations
        .is_member_of_domain(user_id, &office_id)
        .await
        .unwrap();

    assert!(
        is_member_office,
        "User should be member of office after addition"
    );

    // But user should still have access to the room because of permission inheritance (implicitly a member for access purposes)
    let has_room_access_via_inheritance = kernel
        .domain_operations
        .is_member_of_domain(user_id, &room_id)
        .await
        .unwrap();
    assert!(
        has_room_access_via_inheritance,
        "User should have room access because they're in the parent office"
    );
}
