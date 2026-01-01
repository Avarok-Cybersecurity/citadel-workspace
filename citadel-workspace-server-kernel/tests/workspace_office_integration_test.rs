use citadel_workspace_types::{WorkspaceProtocolRequest, WorkspaceProtocolResponse};

use common::async_test_helpers::*;
use common::workspace_test_utils::*;

/// # Workspace Office Integration Test Suite
///
/// Tests workspace-office integration functionality including:
/// - Creating offices within workspaces
/// - Retrieving office details
/// - Listing offices within a workspace
/// - Verifying office-workspace relationships
///
/// ## Test Workflow
/// ```
/// Setup Environment → Create Office in Workspace →
/// Get Office → List Offices → Verify Integration
/// ```
///
/// **Expected Outcome:** Office operations work correctly within workspace context

#[tokio::test]
async fn test_add_office_to_workspace() {
    let kernel = create_test_kernel().await;

    // Create an office in the pre-existing workspace
    let office_name = "Test Office";
    let office_result = execute_command(
        &kernel,
        WorkspaceProtocolRequest::CreateOffice {
            workspace_id: citadel_workspace_server_kernel::WORKSPACE_ROOT_ID.to_string(),
            name: office_name.to_string(),
            description: "Test Office Description".to_string(),
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

    // Check that we can get the office
    let get_office_result = execute_command(
        &kernel,
        WorkspaceProtocolRequest::GetOffice {
            office_id: office_id.clone(),
        },
    )
    .await;
    assert!(get_office_result.is_ok());

    // Check that the office appears in the list of offices
    let list_offices_result = execute_command(&kernel, WorkspaceProtocolRequest::ListOffices).await;

    match list_offices_result {
        Ok(WorkspaceProtocolResponse::Offices(offices)) => {
            assert_eq!(offices.len(), 1);
            assert_eq!(offices[0].name, office_name);
        }
        _ => panic!("Expected Offices response, got {:?}", list_offices_result),
    }
}
