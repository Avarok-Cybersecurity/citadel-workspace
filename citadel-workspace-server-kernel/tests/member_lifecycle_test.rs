use citadel_workspace_server_kernel::WORKSPACE_ROOT_ID;
use citadel_workspace_types::structs::{NodeEntityType, User, UserRole};
use citadel_workspace_types::{WorkspaceProtocolRequest, WorkspaceProtocolResponse};

use common::async_test_helpers::*;
use common::workspace_test_utils::*;

/// # Member Lifecycle Test Suite
///
/// Tests complete user lifecycle management including:
/// - User creation and insertion into system
/// - User addition to multiple domains
/// - Complete user removal from all domains
/// - User deletion from system
/// - Verification of complete cleanup
///
/// ## Lifecycle Flow
/// ```
/// User Creation → Domain Addition → Complete Removal → Verification
/// ```
///
/// **Expected Outcome:** Users can be completely removed from the system with proper cleanup

#[tokio::test]
async fn test_complete_user_removal() {
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

    // Verify user is in the office before removal
    let node = kernel
        .domain_operations
        .backend_tx_manager
        .get_node(&office_id)
        .await
        .unwrap()
        .expect("Office node should exist");

    let user_in_node = node.members.contains(&user_id.to_string());
    assert!(
        user_in_node,
        "User should be in the office members list before removal"
    );

    // Remove user from the office first
    let remove_result = execute_command(
        &kernel,
        WorkspaceProtocolRequest::RemoveMember {
            user_id: user_id.to_string(),
            domain_id: Some(office_id.clone()),
        },
    )
    .await;
    assert!(remove_result.is_ok());

    // Then remove the user completely from the system
    kernel
        .domain_operations
        .backend_tx_manager
        .remove_user(user_id)
        .await
        .unwrap();

    // Verify the user no longer exists
    let user_exists = kernel
        .domain_operations
        .backend_tx_manager
        .get_user(user_id)
        .await
        .unwrap()
        .is_some();

    assert!(!user_exists, "User should have been completely removed");

    // Also verify user is no longer in the office
    let node_after = kernel
        .domain_operations
        .backend_tx_manager
        .get_node(&office_id)
        .await
        .unwrap()
        .expect("Office node should still exist");

    let user_still_in_node = node_after.members.contains(&user_id.to_string());
    assert!(
        !user_still_in_node,
        "User should not be in the office members list after removal"
    );
}
