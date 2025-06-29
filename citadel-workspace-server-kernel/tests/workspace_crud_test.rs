use citadel_workspace_server_kernel::handlers::domain::DomainOperations;
use citadel_workspace_server_kernel::kernel::transaction::TransactionManagerExt;
use citadel_workspace_types::{WorkspaceProtocolRequest, WorkspaceProtocolResponse};

mod common;
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

#[test]
fn test_create_workspace() {
    let (kernel, _db_temp_dir) = create_test_kernel();
    let admin_id = "admin-user";

    // Attempt to create a second workspace, which should fail in the single-workspace model
    let workspace_name = "Another Workspace";
    let workspace_description = "This should not be created";
    let result = kernel.process_command(
        admin_id,
        WorkspaceProtocolRequest::CreateWorkspace {
            name: workspace_name.to_string(),
            description: workspace_description.to_string(),
            workspace_master_password: "password".to_string(),
            metadata: None,
        },
    );

    // Verify the command fails
    assert!(
        result.is_ok(),
        "process_command should return Ok even for app errors"
    );
    match result.unwrap() {
        WorkspaceProtocolResponse::Error(e) => {
            assert_eq!(e, "Failed to create workspace: A root workspace already exists. Cannot create another one.", "Incorrect error message");
        }
        other => panic!("Expected WorkspaceProtocolResponse::Error, got {:?}", other),
    }
}

#[test]
fn test_get_workspace() {
    let (kernel, _db_temp_dir) = create_test_kernel();
    let admin_id = "admin-user";

    // Get the pre-existing workspace
    let get_result = kernel.process_command(admin_id, WorkspaceProtocolRequest::GetWorkspace);

    // Verify the response
    assert!(get_result.is_ok());
    if let Ok(WorkspaceProtocolResponse::Workspace(workspace)) = get_result {
        assert_eq!(
            workspace.id,
            citadel_workspace_server_kernel::WORKSPACE_ROOT_ID
        );
        assert_eq!(workspace.owner_id, "admin-user"); // Default admin
    } else {
        panic!("Expected Workspace response, got {:?}", get_result);
    }
}

#[test]
fn test_update_workspace() {
    let (kernel, _db_temp_dir) = create_test_kernel();
    let admin_id = "admin-user";

    // Update the pre-existing workspace
    let updated_name = "Updated Workspace Name";
    let updated_description = "An updated description";
    let update_result = kernel.process_command(
        admin_id,
        WorkspaceProtocolRequest::UpdateWorkspace {
            name: Some(updated_name.to_string()),
            description: Some(updated_description.to_string()),
            workspace_master_password: "admin-password".to_string(), // from create_test_kernel
            metadata: None,
        },
    );

    // Verify the response
    assert!(update_result.is_ok(), "Update failed: {:?}", update_result);
    if let Ok(WorkspaceProtocolResponse::Workspace(workspace)) = update_result {
        assert_eq!(
            workspace.id,
            citadel_workspace_server_kernel::WORKSPACE_ROOT_ID
        );
        assert_eq!(workspace.name, updated_name);
        assert_eq!(workspace.description, updated_description);
    } else {
        panic!("Expected Workspace response, got {:?}", update_result);
    }

    // Verify the workspace was updated in the transaction manager
    kernel
        .tx_manager()
        .with_read_transaction(|tx| {
            let workspace = tx
                .get_workspace(citadel_workspace_server_kernel::WORKSPACE_ROOT_ID)
                .unwrap();
            assert_eq!(workspace.name, updated_name);
            assert_eq!(workspace.description, updated_description);
            Ok(())
        })
        .unwrap();
}

#[test]
fn test_delete_workspace() {
    let (kernel, _db_temp_dir) = create_test_kernel();
    let admin_id = "admin-user";

    // Attempt to delete the root workspace, which should fail
    let delete_result = kernel.process_command(
        admin_id,
        WorkspaceProtocolRequest::DeleteWorkspace {
            workspace_master_password: "admin-password".to_string(),
        },
    );

    // Verify the command fails as expected
    let expected_error_msg = "Failed to delete workspace: Cannot delete the root workspace";
    match delete_result {
        Ok(WorkspaceProtocolResponse::Error(msg)) => {
            assert_eq!(msg, expected_error_msg, "Incorrect error message when attempting to delete root workspace");
        }
        Ok(other) => panic!("Expected Error response when deleting root workspace, got Ok({:?})", other),
        Err(e) => panic!("process_command returned Err({:?}) instead of Ok(Error(...)) for root workspace deletion", e),
    }

    // Verify the workspace still exists
    kernel
        .tx_manager()
        .with_read_transaction(|tx| {
            let workspace = tx.get_workspace(citadel_workspace_server_kernel::WORKSPACE_ROOT_ID);
            assert!(
                workspace.is_some(),
                "Root workspace should not have been deleted"
            );
            Ok(())
        })
        .unwrap();
} 