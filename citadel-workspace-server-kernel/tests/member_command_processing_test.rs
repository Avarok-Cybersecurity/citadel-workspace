use citadel_workspace_server_kernel::handlers::domain::async_ops::AsyncDomainOperations;
use citadel_workspace_server_kernel::WORKSPACE_ROOT_ID;
use citadel_workspace_types::structs::{Domain, User, UserRole};
use citadel_workspace_types::{WorkspaceProtocolRequest, WorkspaceProtocolResponse};

#[path = "common/mod.rs"]
mod common;
use common::async_test_helpers::*;
use common::workspace_test_utils::*;

/// # Member Command Processing Test Suite
///
/// Tests protocol-level member operations through command processing including:
/// - Processing AddMember commands through the protocol layer
/// - Processing RemoveMember commands through the protocol layer
/// - Verifying command responses and success status
/// - Testing complete workflow from command to persistence
/// - Validating member state changes after commands
///
/// ## Command Processing Flow
/// ```
/// Client Command → Protocol Processing → Domain Operations → Persistence → Response
/// ```
///
/// **Expected Outcome:** Protocol commands properly handle member operations end-to-end

#[tokio::test]
async fn test_member_command_processing() {
    // Use simpler kernel setup that doesn't involve full network stack
    let kernel = create_test_kernel().await;

    citadel_logging::setup_log();
    citadel_logging::trace!(target: "citadel", "Starting test_member_command_processing");

    citadel_logging::trace!(target: "citadel", "Created kernel");

    // Create a test user
    let user_id = "test_user";
    let user = User::new(
        user_id.to_string(),
        format!("Test {}", user_id),
        UserRole::Member,
    );

    citadel_logging::trace!(target: "citadel", "Created test user");

    // Insert the user
    kernel
        .domain_operations
        .backend_tx_manager
        .insert_user(user_id.to_string(), user)
        .await
        .unwrap();

    citadel_logging::trace!(target: "citadel", "Inserted test user");

    // Verify workspace exists from the test kernel setup
    let get_workspace_req = WorkspaceProtocolRequest::GetWorkspace;
    match execute_command(&kernel, get_workspace_req).await.unwrap() {
        WorkspaceProtocolResponse::Workspace(_ws) => {
            citadel_logging::trace!(target: "citadel", "Workspace exists as expected");
        }
        other => {
            panic!(
                "Expected workspace to exist from create_test_kernel, got: {:?}",
                other
            );
        }
    }

    // Create office through proper command processing to ensure permissions are set correctly
    let create_office_req = WorkspaceProtocolRequest::CreateOffice {
        workspace_id: WORKSPACE_ROOT_ID.to_string(),
        name: "Test Office".to_string(),
        description: "Test Office Description".to_string(),
        mdx_content: None,
        metadata: None,
    };

    let office_response = execute_command(&kernel, create_office_req).await.unwrap();
    let office_id = match office_response {
        WorkspaceProtocolResponse::Office(office) => {
            citadel_logging::trace!(target: "citadel", "Office created with ID: {}", office.id);
            office.id
        }
        _ => panic!("Failed to create office: {:?}", office_response),
    };

    citadel_logging::trace!(target: "citadel", "Office created successfully");

    // Add user to the office via command processing
    citadel_logging::trace!(target: "citadel", "About to add member via command");
    let result = execute_command(
        &kernel,
        WorkspaceProtocolRequest::AddMember {
            user_id: user_id.to_string(),
            office_id: Some(office_id.clone()),
            room_id: None,
            role: UserRole::Member,
            metadata: None,
        },
    )
    .await
    .unwrap();

    citadel_logging::trace!(target: "citadel", "Add member command processed: {:?}", result);

    match result {
        WorkspaceProtocolResponse::Success(_) => {
            citadel_logging::trace!(target: "citadel", "Add member command succeeded");
        }
        _ => panic!("Failed to add member: {:?}", result),
    }

    // Verify the user is in the office
    citadel_logging::trace!(target: "citadel", "Verifying user is in office");
    let office_domain = kernel
        .domain_operations
        .backend_tx_manager
        .get_domain(&office_id)
        .await
        .unwrap();

    let office_exists = if let Some(Domain::Office { office }) = office_domain {
        let result = office.members.contains(&user_id.to_string());
        citadel_logging::trace!(target: "citadel", "User in office: {}", result);
        result
    } else {
        citadel_logging::trace!(target: "citadel", "Office not found");
        false
    };

    citadel_logging::trace!(target: "citadel", "Verified user in office: {}", office_exists);
    assert!(office_exists, "User should be in the office after adding");

    // Remove user from the office via command processing
    citadel_logging::trace!(target: "citadel", "About to remove member via command");
    let result = execute_command(
        &kernel,
        WorkspaceProtocolRequest::RemoveMember {
            user_id: user_id.to_string(),
            office_id: Some(office_id.clone()),
            room_id: None,
        },
    )
    .await
    .unwrap();

    citadel_logging::trace!(target: "citadel", "Remove member command processed: {:?}", result);

    match result {
        WorkspaceProtocolResponse::Success(_) => {
            citadel_logging::trace!(target: "citadel", "Remove member command succeeded");
        }
        _ => panic!("Failed to remove member: {:?}", result),
    }

    // Verify the user is no longer in the office
    citadel_logging::trace!(target: "citadel", "Verifying user is no longer in office");
    let office_domain = kernel
        .domain_operations
        .backend_tx_manager
        .get_domain(&office_id)
        .await
        .unwrap();

    let user_in_office = if let Some(Domain::Office { office }) = office_domain {
        let result = office.members.contains(&user_id.to_string());
        citadel_logging::trace!(target: "citadel", "User in office: {}", result);
        result
    } else {
        citadel_logging::trace!(target: "citadel", "Office not found");
        false
    };

    citadel_logging::trace!(target: "citadel", "Verified user not in office: {}", !user_in_office);
    assert!(
        !user_in_office,
        "User should not be in the office after removal"
    );
    citadel_logging::trace!(target: "citadel", "Test completed successfully");
}
