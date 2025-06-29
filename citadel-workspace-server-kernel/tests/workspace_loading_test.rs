use citadel_workspace_types::{WorkspaceProtocolRequest, WorkspaceProtocolResponse};

mod common;
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

#[test]
fn test_load_workspace() {
    let (kernel, _db_temp_dir) = create_test_kernel();
    let admin_id = "admin-user";

    // Load the workspace (should return the single pre-existing workspace)
    let load_result = kernel.process_command(admin_id, WorkspaceProtocolRequest::LoadWorkspace);

    // Verify the response
    assert!(load_result.is_ok());
    if let Ok(WorkspaceProtocolResponse::Workspace(workspace)) = load_result {
        assert_eq!(
            workspace.id,
            citadel_workspace_server_kernel::WORKSPACE_ROOT_ID
        );
        assert_eq!(workspace.owner_id, "admin-user");
    } else {
        panic!("Expected Workspace response, got {:?}", load_result);
    }
} 