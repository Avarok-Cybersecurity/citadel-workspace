use citadel_workspace_types::{WorkspaceProtocolRequest, WorkspaceProtocolResponse};
use citadel_workspace_types::structs::NodeEntityType;

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
        WorkspaceProtocolRequest::CreateNode {
            parent_id: Some(citadel_workspace_server_kernel::WORKSPACE_ROOT_ID.to_string()),
            entity_type: NodeEntityType::Child("Office".to_string()),
            name: office_name.to_string(),
            description: "Test Office Description".to_string(),
        },
    )
    .await;

    let office_id = match office_result {
        Ok(WorkspaceProtocolResponse::Node(node)) => node.id,
        _ => panic!("Expected Node response, got {:?}", office_result),
    };

    // Check that we can get the office
    let get_office_result = execute_command(
        &kernel,
        WorkspaceProtocolRequest::GetNode {
            node_id: office_id.clone(),
        },
    )
    .await;
    assert!(get_office_result.is_ok());

    // Check that the office appears in the list of offices
    let list_offices_result = execute_command(
        &kernel,
        WorkspaceProtocolRequest::ListNodes {
            parent_id: None,
            depth: Some(1),
            entity_types: Some(vec![NodeEntityType::Child("Office".to_string())]),
        },
    )
    .await;

    match list_offices_result {
        Ok(WorkspaceProtocolResponse::Nodes(offices)) => {
            assert_eq!(offices.len(), 1);
            assert_eq!(offices[0].name, office_name);
        }
        _ => panic!("Expected Nodes response, got {:?}", list_offices_result),
    }
}
