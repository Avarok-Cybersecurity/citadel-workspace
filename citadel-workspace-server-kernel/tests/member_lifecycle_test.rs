use citadel_workspace_server_kernel::WORKSPACE_ROOT_ID;
use citadel_workspace_types::structs::{Domain, User, UserRole};
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
        WorkspaceProtocolRequest::CreateOffice {
            workspace_id: WORKSPACE_ROOT_ID.to_string(),
            name: "Test Office".to_string(),
            description: "For Testing".to_string(),
            mdx_content: None,
            metadata: None,
            is_default: None,
        },
    )
    .await;

    let office_id = match office_result {
        Ok(WorkspaceProtocolResponse::Office(office)) => office.id,
        _ => panic!("Expected Office response, got {:?}", office_result),
    };

    // Add the user to the office
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

    // Verify user is in the office before removal
    let office_domain = kernel
        .domain_operations
        .backend_tx_manager
        .get_domain(&office_id)
        .await
        .unwrap()
        .expect("Office domain should exist");

    match &office_domain {
        Domain::Office { office } => {
            assert!(
                office.members.contains(&user_id.to_string()),
                "User should be in the office members list before removal"
            );
        }
        _ => panic!("Expected office domain"),
    }

    // Remove user from the office first
    let remove_result = execute_command(
        &kernel,
        WorkspaceProtocolRequest::RemoveMember {
            user_id: user_id.to_string(),
            office_id: Some(office_id.clone()),
            room_id: None,
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
    let office_domain_after = kernel
        .domain_operations
        .backend_tx_manager
        .get_domain(&office_id)
        .await
        .unwrap()
        .expect("Office domain should still exist");

    match office_domain_after {
        Domain::Office { office } => {
            assert!(
                !office.members.contains(&user_id.to_string()),
                "User should not be in the office members list after removal"
            );
        }
        _ => panic!("Expected office domain"),
    }
}
