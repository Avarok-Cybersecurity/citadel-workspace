use citadel_workspace_types::{WorkspaceProtocolRequest, WorkspaceProtocolResponse};

#[path = "common/mod.rs"]
mod common;
use common::async_test_helpers::*;
use common::workspace_test_utils::*;

/// # Workspace CRUD Operations Test Suite
///
/// Tests core workspace create, read, update, delete operations including:
/// - Creating workspace (expected to fail for additional workspaces)
/// - Retrieving workspace details  
/// - Updating workspace properties (name, description)
/// - Deleting workspace (expected to fail for root workspace)
///
/// ## Test Workflow
/// ```
/// Setup Environment → Test Create (Fail) → Test Get →
/// Test Update → Verify Update → Test Delete (Fail) → Verify Still Exists
/// ```
///
/// **Expected Outcome:** CRUD operations work correctly with proper validation

#[tokio::test]
async fn test_create_workspace() {
    let kernel = create_test_kernel().await;

    // Attempt to create a second workspace, which should fail in the single-workspace model
    let workspace_name = "Another Workspace";
    let workspace_description = "This should not be created";
    let result = execute_command(
        &kernel,
        WorkspaceProtocolRequest::CreateWorkspace {
            name: workspace_name.to_string(),
            description: workspace_description.to_string(),
            workspace_master_password: "password".to_string(),
            metadata: None,
        },
    )
    .await;

    // Verify the command fails
    match result {
        Ok(WorkspaceProtocolResponse::Error(e)) => {
            assert_eq!(e, "Failed to create workspace: A root workspace already exists. Cannot create another one.", "Incorrect error message");
        }
        Ok(other) => panic!("Expected WorkspaceProtocolResponse::Error, got {:?}", other),
        Err(e) => panic!("Command failed with error: {:?}", e),
    }
}

#[tokio::test]
async fn test_get_workspace() {
    let kernel = create_test_kernel().await;

    // Get the pre-existing workspace
    let get_result = execute_command(&kernel, WorkspaceProtocolRequest::GetWorkspace).await;

    // Verify the response
    match get_result {
        Ok(WorkspaceProtocolResponse::Workspace(workspace)) => {
            assert_eq!(
                workspace.id,
                citadel_workspace_server_kernel::WORKSPACE_ROOT_ID
            );
            assert_eq!(workspace.owner_id, "admin-user"); // Default admin
        }
        Ok(other) => panic!("Expected Workspace response, got {:?}", other),
        Err(e) => panic!("Command failed with error: {:?}", e),
    }
}

#[tokio::test]
async fn test_update_workspace() {
    let kernel = create_test_kernel().await;

    // Update the pre-existing workspace
    let updated_name = "Updated Workspace Name";
    let updated_description = "An updated description";
    let update_result = execute_command(
        &kernel,
        WorkspaceProtocolRequest::UpdateWorkspace {
            name: Some(updated_name.to_string()),
            description: Some(updated_description.to_string()),
            workspace_master_password: "admin-password".to_string(), // from create_test_kernel
            metadata: None,
        },
    )
    .await;

    // Verify the response
    match update_result {
        Ok(WorkspaceProtocolResponse::Workspace(workspace)) => {
            assert_eq!(
                workspace.id,
                citadel_workspace_server_kernel::WORKSPACE_ROOT_ID
            );
            assert_eq!(workspace.name, updated_name);
            assert_eq!(workspace.description, updated_description);
        }
        Ok(other) => panic!("Expected Workspace response, got {:?}", other),
        Err(e) => panic!("Update failed with error: {:?}", e),
    }

    // Verify the workspace was updated in the backend
    let workspace = kernel
        .domain_operations
        .backend_tx_manager
        .get_domain(citadel_workspace_server_kernel::WORKSPACE_ROOT_ID)
        .await
        .unwrap()
        .expect("Workspace should exist");
    assert_eq!(workspace.name(), updated_name);
    assert_eq!(workspace.description(), updated_description);
}

#[tokio::test]
async fn test_delete_workspace() {
    let kernel = create_test_kernel().await;

    // Attempt to delete the root workspace, which should fail
    let delete_result = execute_command(
        &kernel,
        WorkspaceProtocolRequest::DeleteWorkspace {
            workspace_master_password: "admin-password".to_string(),
        },
    )
    .await;

    // Verify the command fails as expected
    let expected_error_msg = "Failed to delete workspace: Cannot delete the root workspace";
    match delete_result {
        Ok(WorkspaceProtocolResponse::Error(msg)) => {
            assert_eq!(
                msg, expected_error_msg,
                "Incorrect error message when attempting to delete root workspace"
            );
        }
        Ok(other) => panic!(
            "Expected Error response when deleting root workspace, got {:?}",
            other
        ),
        Err(e) => panic!("Command failed with error: {:?}", e),
    }

    // Verify the workspace still exists
    let workspace = kernel
        .domain_operations
        .backend_tx_manager
        .get_domain(citadel_workspace_server_kernel::WORKSPACE_ROOT_ID)
        .await
        .unwrap();
    assert!(
        workspace.is_some(),
        "Root workspace should not have been deleted"
    );
}
