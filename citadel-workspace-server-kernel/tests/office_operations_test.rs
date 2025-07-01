use citadel_workspace_server_kernel::WORKSPACE_ROOT_ID;
use citadel_workspace_types::{WorkspaceProtocolRequest, WorkspaceProtocolResponse};
use rstest::*;
use std::time::Duration;

mod common;
use common::integration_test_utils::*;

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
#[rstest]
#[tokio::test]
#[timeout(Duration::from_secs(15))]
async fn test_office_operations() {
    println!("Setting up test environment...");
    let (_kernel, internal_service_addr, server_addr, admin_username, admin_password, _db_temp_dir) =
        setup_test_environment().await.unwrap();
    println!("Test environment setup complete.");

    println!("Registering and connecting admin user...");
    // Use admin credentials to connect
    let (to_service, mut from_service, admin_cid) = register_and_connect_user(
        internal_service_addr,
        server_addr,
        &admin_username,
        &admin_password,
    )
    .await
    .unwrap();

    println!("Admin user registered and connected with CID: {admin_cid}.");

    // The root workspace is created during `setup_test_environment`, so we don't need to create it again.
    // We can directly use WORKSPACE_ROOT_ID for further operations.
    let actual_workspace_id = WORKSPACE_ROOT_ID.to_string();
    println!(
        "Using pre-existing root workspace with ID: {}",
        actual_workspace_id
    );

    // --- Test: Attempt to update workspace with WRONG password ---
    println!("Attempting to update root workspace with wrong password...");
    let update_workspace_wrong_pw_cmd = WorkspaceProtocolRequest::UpdateWorkspace {
        name: Some("Attempted Update Name".to_string()),
        description: Some("This update should fail due to wrong password".to_string()),
        workspace_master_password: "wrong-password".to_string(), // Provide wrong password (as String)
        metadata: None,
    };

    let error_response = send_workspace_command(
        &to_service,
        &mut from_service,
        admin_cid,
        update_workspace_wrong_pw_cmd,
    )
    .await
    .expect("Sending wrong password command should succeed, but result in error response");

    match error_response {
        WorkspaceProtocolResponse::Error(msg) => {
            assert!(
                msg.contains("Incorrect workspace master password"),
                "Expected password error, got: {}",
                msg
            );
            println!("Received expected error for wrong password: {}", msg);
        }
        _ => panic!(
            "Expected Error response after attempting to update workspace with wrong password, got {:?}",
            error_response
        ),
    }
    // --- End Test ---

    // Create an office using the command processor instead of directly
    println!("Creating test office...");
    let create_office_cmd = WorkspaceProtocolRequest::CreateOffice {
        workspace_id: actual_workspace_id.clone(), // Use the extracted workspace ID
        name: "Test Office".to_string(),
        description: "A test office".to_string(),
        mdx_content: Some("# Test Office\nThis is a test office".to_string()),
        metadata: None,
    };

    let response =
        send_workspace_command(&to_service, &mut from_service, admin_cid, create_office_cmd)
            .await
            .unwrap();

    let office_id = match response {
        WorkspaceProtocolResponse::Office(office) => {
            println!("Created office: {:?}", office);
            office.id
        }
        _ => panic!("Expected Office response"),
    };

    println!("Test office created.");

    println!("Getting test office...");
    let get_office_cmd = WorkspaceProtocolRequest::GetOffice {
        office_id: office_id.clone(),
    };

    let response =
        send_workspace_command(&to_service, &mut from_service, admin_cid, get_office_cmd)
            .await
            .unwrap();

    match response {
        WorkspaceProtocolResponse::Office(office) => {
            assert_eq!(office.name, "Test Office");
            assert_eq!(office.description, "A test office");
            assert_eq!(office.mdx_content, "# Test Office\nThis is a test office");
        }
        _ => panic!("Expected Office response"),
    }

    println!("Test office retrieved.");

    println!("Updating test office...");
    let update_office_cmd = WorkspaceProtocolRequest::UpdateOffice {
        office_id: office_id.clone(),
        name: Some("Updated Office".to_string()),
        description: None,
        mdx_content: Some("# Updated Office\nThis content has been updated".to_string()),
        metadata: None,
    };

    let response =
        send_workspace_command(&to_service, &mut from_service, admin_cid, update_office_cmd)
            .await
            .unwrap();

    match response {
        WorkspaceProtocolResponse::Office(office) => {
            assert_eq!(office.name, "Updated Office");
            assert_eq!(office.description, "A test office");
            assert_eq!(
                office.mdx_content,
                "# Updated Office\nThis content has been updated"
            );
        }
        _ => panic!("Expected Office response"),
    }

    println!("Test office updated.");

    println!("Listing offices...");
    let list_offices_cmd = WorkspaceProtocolRequest::ListOffices {};

    let response =
        send_workspace_command(&to_service, &mut from_service, admin_cid, list_offices_cmd)
            .await
            .unwrap();

    match response {
        WorkspaceProtocolResponse::Offices(offices) => {
            assert!(
                !offices.is_empty(),
                "Expected at least 1 office, found {}",
                offices.len()
            );

            // Find the "Updated Office" in the list
            let updated_office = offices
                .iter()
                .find(|o| o.name == "Updated Office")
                .expect("Couldn't find 'Updated Office' in the returned offices list");

            assert_eq!(updated_office.name, "Updated Office");
            assert_eq!(updated_office.description, "A test office");
        }
        _ => panic!("Expected Offices response"),
    }

    println!("Offices listed.");

    println!("Deleting test office...");
    let delete_office_cmd = WorkspaceProtocolRequest::DeleteOffice { office_id };

    let response =
        send_workspace_command(&to_service, &mut from_service, admin_cid, delete_office_cmd)
            .await
            .unwrap();

    match response {
        WorkspaceProtocolResponse::Success(_) => {}
        _ => panic!("Expected Success response"),
    }

    println!("Test office deleted.");

    println!("Verifying office was deleted...");
    let list_offices_cmd = WorkspaceProtocolRequest::ListOffices {};

    let response =
        send_workspace_command(&to_service, &mut from_service, admin_cid, list_offices_cmd)
            .await
            .unwrap();

    match response {
        WorkspaceProtocolResponse::Offices(offices) => {
            // With our single workspace model, after deleting the office,
            // we should have 0 offices remaining
            assert_eq!(offices.len(), 0);
        }
        _ => panic!("Expected Offices response"),
    }

    println!("Test complete.");
}
