use citadel_workspace_server_kernel::WORKSPACE_ROOT_ID;
use citadel_workspace_types::structs::{NodeEntityType, User, UserRole};
use citadel_workspace_types::{WorkspaceProtocolRequest, WorkspaceProtocolResponse};

use common::async_test_helpers::*;
use common::workspace_test_utils::*;

/// # Member Domain Operations Test Suite
///
/// Tests basic member operations within domain hierarchy including:
/// - Adding users to domains (offices, rooms, etc.)
/// - Removing users from domains
/// - Verifying domain membership changes
/// - Testing proper member list updates
///
/// ## Test Coverage
/// - User addition to office domains
/// - User removal from office domains
/// - Membership verification after operations
///
/// **Expected Outcome:** Domain membership operations work correctly and maintain consistent state

#[tokio::test]
async fn test_add_user_to_domain() {
    let kernel = create_test_kernel().await;

    // Create a test user
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

    // Add the user to the office
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

    assert!(
        node.members.contains(&user_id.to_string()),
        "User should be in the office members list"
    );
}

#[tokio::test]
async fn test_remove_user_from_domain() {
    let kernel = create_test_kernel().await;

    // Create a test user
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

    // Add the user to the office first
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

    // Remove the user from the office
    let remove_result = execute_command(
        &kernel,
        WorkspaceProtocolRequest::RemoveMember {
            user_id: user_id.to_string(),
            domain_id: Some(office_id.clone()),
        },
    )
    .await;
    assert!(remove_result.is_ok());

    // Verify the user is no longer in the office
    let node = kernel
        .domain_operations
        .backend_tx_manager
        .get_node(&office_id)
        .await
        .unwrap()
        .expect("Office node should exist");

    assert!(
        !node.members.contains(&user_id.to_string()),
        "User should not be in the office members list after removal"
    );
}
