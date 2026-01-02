use citadel_workspace_types::{WorkspaceProtocolRequest, WorkspaceProtocolResponse};

use common::workspace_test_utils::{create_test_kernel, TEST_ADMIN_USER_ID};

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
    let load_result = process_command_with_user(
        &*kernel,
        &WorkspaceProtocolRequest::GetWorkspace,
        TEST_ADMIN_USER_ID,
    )
    .await;

    // Verify the response
    assert!(load_result.is_ok());
    match load_result {
        Ok(WorkspaceProtocolResponse::Workspace(workspace)) => {
            assert_eq!(
                workspace.id,
                citadel_workspace_server_kernel::WORKSPACE_ROOT_ID
            );
            println!("Workspace loaded successfully: {}", workspace.name);
        }
        other => panic!("Expected Workspace response, got {:?}", other),
    }
}
