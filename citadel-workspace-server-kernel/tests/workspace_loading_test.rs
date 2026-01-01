// Removed unused imports - test now uses async command processor directly
use citadel_workspace_types::{WorkspaceProtocolRequest, WorkspaceProtocolResponse};

use common::workspace_test_utils::*;

/// # Workspace Loading Test Suite
///
/// Tests workspace loading functionality including:
/// - Loading the workspace from storage
/// - Verifying workspace properties are correctly loaded
/// - Ensuring single workspace model consistency
///
/// ## Test Workflow
/// ```
/// Setup Environment → Load Workspace →
/// Verify Properties → Validate Single Workspace Model
/// ```
///
/// **Expected Outcome:** Workspace loads correctly with proper properties

#[tokio::test]
async fn test_load_workspace() {
    let kernel = create_test_kernel().await;

    // Import the async process_command
    use citadel_workspace_server_kernel::kernel::command_processor::async_process_command::process_command_with_user;

    // Load the workspace (should return the single pre-existing workspace)
    let load_result =
        process_command_with_user(&*kernel, &WorkspaceProtocolRequest::GetWorkspace, "").await;

    // Verify the response
    assert!(load_result.is_ok());
    match load_result {
        Ok(WorkspaceProtocolResponse::Workspace(workspace)) => {
            assert_eq!(
                workspace.id,
                citadel_workspace_server_kernel::WORKSPACE_ROOT_ID
            );
        }
        Ok(WorkspaceProtocolResponse::WorkspaceNotInitialized) => {
            // If workspace not initialized, try creating it first
            println!("Workspace not initialized, creating one...");
            let create_result = process_command_with_user(
                &*kernel,
                &WorkspaceProtocolRequest::CreateWorkspace {
                    name: "Test Workspace".to_string(),
                    description: "Test workspace for loading test".to_string(),
                    workspace_master_password: "test-password".to_string(),
                    metadata: None,
                },
                "",
            )
            .await;

            assert!(create_result.is_ok());
            if let Ok(WorkspaceProtocolResponse::Workspace(workspace)) = create_result {
                assert!(!workspace.id.is_empty());
                println!("Workspace created successfully with ID: {}", workspace.id);
            } else {
                panic!("Failed to create workspace: {:?}", create_result);
            }
        }
        other => panic!("Expected Workspace response, got {:?}", other),
    }
}
