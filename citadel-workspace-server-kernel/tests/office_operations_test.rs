use citadel_workspace_types::{WorkspaceProtocolRequest, WorkspaceProtocolResponse};

use common::async_test_helpers::*;
use common::workspace_test_utils::*;

/// # Office Operations Integration Test
///
/// Tests comprehensive office CRUD operations including:
/// - Creating offices with workspace validation
/// - Retrieving office details
/// - Updating office properties (name, description, mdx_content)
/// - Listing all offices
/// - Deleting offices and verification
/// - Error handling for wrong workspace passwords
///
/// ## Test Workflow
/// ```
/// Setup Environment → Connect Admin → Test Wrong Password →
/// Create Office → Get Office → Update Office → List Offices →
/// Delete Office → Verify Deletion
/// ```
///
/// **Expected Outcome:** All office operations succeed, wrong password fails gracefully
#[tokio::test]
async fn test_office_operations() {
    let kernel = create_test_kernel().await;

    // Get the root workspace ID
    let workspace_id = citadel_workspace_server_kernel::WORKSPACE_ROOT_ID.to_string();

    // Test: Attempt to update workspace with WRONG password
    let update_workspace_wrong_pw = execute_command(
        &kernel,
        WorkspaceProtocolRequest::UpdateWorkspace {
            name: Some("Attempted Update Name".to_string()),
            description: Some("This update should fail due to wrong password".to_string()),
            workspace_master_password: "wrong-password".to_string(),
            metadata: None,
        },
    )
    .await
    .unwrap();

    match update_workspace_wrong_pw {
        WorkspaceProtocolResponse::Error(msg) => {
            assert!(
                msg.contains("Invalid workspace password")
                    || msg.contains("Incorrect workspace master password")
                    || msg.contains("Invalid workspace master access password"),
                "Expected password error, got: {}",
                msg
            );
        }
        _ => panic!("Expected Error response for wrong password"),
    }

    // Create an office
    let create_office_response = execute_command(
        &kernel,
        WorkspaceProtocolRequest::CreateOffice {
            workspace_id: workspace_id.clone(),
            name: "Test Office".to_string(),
            description: "A test office".to_string(),
            mdx_content: Some("# Test Office\nThis is a test office".to_string()),
            metadata: None,
            is_default: None,
        },
    )
    .await
    .unwrap();

    let office = extract_office(create_office_response).expect("Failed to create office");
    let office_id = office.id.clone();

    // Get the office
    let get_office_response = execute_command(
        &kernel,
        WorkspaceProtocolRequest::GetOffice {
            office_id: office_id.clone(),
        },
    )
    .await
    .unwrap();

    let retrieved_office = extract_office(get_office_response).expect("Failed to get office");
    assert_eq!(retrieved_office.name, "Test Office");
    assert_eq!(retrieved_office.description, "A test office");
    assert_eq!(
        retrieved_office.mdx_content,
        "# Test Office\nThis is a test office"
    );

    // Update the office
    let update_office_response = execute_command(
        &kernel,
        WorkspaceProtocolRequest::UpdateOffice {
            office_id: office_id.clone(),
            name: Some("Updated Office".to_string()),
            description: None,
            mdx_content: Some("# Updated Office\nThis content has been updated".to_string()),
            metadata: None,
            is_default: None,
        },
    )
    .await
    .unwrap();

    let updated_office = extract_office(update_office_response).expect("Failed to update office");
    assert_eq!(updated_office.name, "Updated Office");
    assert_eq!(updated_office.description, "A test office");
    assert_eq!(
        updated_office.mdx_content,
        "# Updated Office\nThis content has been updated"
    );

    // List offices
    let list_offices_response = execute_command(&kernel, WorkspaceProtocolRequest::ListOffices {})
        .await
        .unwrap();

    match list_offices_response {
        WorkspaceProtocolResponse::Offices(offices) => {
            assert!(!offices.is_empty(), "Expected at least 1 office");

            let updated_office = offices
                .iter()
                .find(|o| o.name == "Updated Office")
                .expect("Couldn't find 'Updated Office' in the list");

            assert_eq!(updated_office.name, "Updated Office");
            assert_eq!(updated_office.description, "A test office");
        }
        _ => panic!("Expected Offices response"),
    }

    // Delete the office
    let delete_office_response = execute_command(
        &kernel,
        WorkspaceProtocolRequest::DeleteOffice {
            office_id: office_id.clone(),
        },
    )
    .await
    .unwrap();

    match delete_office_response {
        WorkspaceProtocolResponse::DeleteOffice {
            office_id: deleted_id,
        } => {
            assert_eq!(deleted_id, office_id, "Deleted office ID should match");
        }
        other => panic!("Expected DeleteOffice response, got: {:?}", other),
    }

    // Verify office was deleted
    let list_offices_after_delete =
        execute_command(&kernel, WorkspaceProtocolRequest::ListOffices {})
            .await
            .unwrap();

    match list_offices_after_delete {
        WorkspaceProtocolResponse::Offices(offices) => {
            assert_eq!(offices.len(), 0, "Expected 0 offices after deletion");
        }
        _ => panic!("Expected Offices response"),
    }
}
