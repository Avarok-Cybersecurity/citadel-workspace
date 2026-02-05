use citadel_workspace_types::{WorkspaceProtocolRequest, WorkspaceProtocolResponse};

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
async fn test_create_workspace_wrong_password() {
    let kernel = create_test_kernel().await;

    // Attempt to create a second workspace with wrong password
    let result = execute_command(
        &kernel,
        WorkspaceProtocolRequest::CreateWorkspace {
            name: "Another Workspace".to_string(),
            description: "Should fail with wrong password".to_string(),
            workspace_master_password: "wrong-password".to_string(),
            metadata: None,
        },
    )
    .await;

    // Verify the command fails with invalid password error
    match result {
        Ok(WorkspaceProtocolResponse::Error(e)) => {
            assert!(
                e.contains("Invalid workspace master password"),
                "Expected password error, got: {}",
                e
            );
        }
        Ok(other) => panic!("Expected Error response, got {:?}", other),
        Err(e) => panic!("Command failed unexpectedly: {:?}", e),
    }
}

#[tokio::test]
async fn test_create_additional_workspace() {
    let kernel = create_test_kernel().await;

    // Create a second workspace with the correct master password
    let result = execute_command(
        &kernel,
        WorkspaceProtocolRequest::CreateWorkspace {
            name: "Second Workspace".to_string(),
            description: "A second workspace for testing".to_string(),
            workspace_master_password: "admin-password".to_string(),
            metadata: None,
        },
    )
    .await;

    // Verify the workspace was created with a UUID (not the sentinel)
    match result {
        Ok(WorkspaceProtocolResponse::Workspace(workspace)) => {
            assert_ne!(
                workspace.id,
                citadel_workspace_server_kernel::WORKSPACE_ROOT_ID,
                "Additional workspace should have a UUID, not the sentinel ID"
            );
            assert_eq!(workspace.name, "Second Workspace");
            assert_eq!(workspace.description, "A second workspace for testing");
            assert_eq!(
                workspace.owner_id,
                common::workspace_test_utils::TEST_ADMIN_USER_ID
            );
        }
        Ok(other) => panic!("Expected Workspace response, got {:?}", other),
        Err(e) => panic!("Command failed unexpectedly: {:?}", e),
    }
}

#[tokio::test]
async fn test_get_workspace() {
    let kernel = create_test_kernel().await;

    // Get the pre-existing workspace
    let get_result = execute_command(
        &kernel,
        WorkspaceProtocolRequest::GetWorkspace { workspace_id: None },
    )
    .await;

    // Verify the response
    match get_result {
        Ok(WorkspaceProtocolResponse::Workspace(workspace)) => {
            assert_eq!(
                workspace.id,
                citadel_workspace_server_kernel::WORKSPACE_ROOT_ID
            );
            assert_eq!(
                workspace.owner_id,
                common::workspace_test_utils::TEST_ADMIN_USER_ID
            ); // Test admin
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
            workspace_id: None,
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
            workspace_id: None,
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

#[tokio::test]
async fn test_list_workspaces() {
    let kernel = create_test_kernel().await;

    // List workspaces - should return at least the root workspace
    let result = execute_command(&kernel, WorkspaceProtocolRequest::ListWorkspaces).await;

    match result {
        Ok(WorkspaceProtocolResponse::Workspaces(workspaces)) => {
            assert!(!workspaces.is_empty(), "Should have at least one workspace");

            // Find the root workspace
            let root = workspaces
                .iter()
                .find(|ws| ws.id == citadel_workspace_server_kernel::WORKSPACE_ROOT_ID);
            assert!(root.is_some(), "Root workspace should be in the list");
            assert!(
                root.unwrap().is_default,
                "Root workspace should be marked as default"
            );
        }
        Ok(other) => panic!("Expected Workspaces response, got {:?}", other),
        Err(e) => panic!("Command failed: {:?}", e),
    }
}
