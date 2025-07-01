#[path = "common/mod.rs"]
mod common;

use common::member_test_utils::*;
use rstest::rstest;
use std::error::Error;
use std::time::Duration;
use tokio::time::timeout;

use citadel_workspace_server_kernel::WORKSPACE_ROOT_ID;
use citadel_workspace_types::structs::{Office, UserRole};
use citadel_workspace_types::{WorkspaceProtocolRequest, WorkspaceProtocolResponse};

#[rstest]
#[tokio::test]
#[timeout(Duration::from_secs(15))]
async fn test_admin_can_add_multiple_users_to_office() {
    let (
        _kernel,
        _internal_service_addr,
        _server_addr,
        _admin_username,
        _admin_password,
        _db_temp_dir,
    ) = setup_test_environment().await.unwrap();

    let user1_id = "user1_for_multi_add_test";
    let user2_id = "user2_for_multi_add_test";

    let get_workspace_req = WorkspaceProtocolRequest::GetWorkspace;

    match _kernel.process_command(&_admin_username, get_workspace_req) {
        Ok(WorkspaceProtocolResponse::Workspace(_ws_details)) => {
            println!(
                "[Test MultiAdd] Workspace created successfully by actor {}.",
                _admin_username
            );
        }
        Ok(other) => panic!(
            "[Test MultiAdd] CreateWorkspace for {} by actor {} returned unexpected response: {:?}",
            _admin_username, _admin_username, other
        ),
        Err(e) => panic!(
            "[Test MultiAdd] CreateWorkspace for {} by actor {} failed: {:?}",
            _admin_username, _admin_username, e
        ),
    }

    // Inject the necessary users for the test
    _kernel
        .inject_user_for_test(user1_id, UserRole::Member)
        .expect("Failed to inject user1_id for test");
    _kernel
        .inject_user_for_test(user2_id, UserRole::Member)
        .expect("Failed to inject user2_id for test");

    let create_office_req = WorkspaceProtocolRequest::CreateOffice {
        workspace_id: WORKSPACE_ROOT_ID.to_string(),
        name: "test_office_multi_add".to_string(),
        description: String::new(),
        mdx_content: None,
        metadata: None,
    };

    let office: Office = match _kernel.process_command(&_admin_username, create_office_req) {
        Ok(WorkspaceProtocolResponse::Office(o)) => {
            println!(
                "[Test MultiAdd] Office {:?} created successfully by actor {}.",
                o.id, _admin_username
            );
            o
        }
        Ok(other) => panic!(
            "[Test MultiAdd] CreateOffice by actor {} returned unexpected response: {:?}",
            _admin_username, other
        ),
        Err(e) => panic!(
            "[Test MultiAdd] CreateOffice by actor {} failed: {:?}",
            _admin_username, e
        ),
    };

    // Test adding first user
    let add_user1_req = WorkspaceProtocolRequest::AddMember {
        user_id: user1_id.to_string(),
        office_id: Some(office.id.clone()),
        room_id: None,
        role: UserRole::Member,
        metadata: None,
    };

    match _kernel.process_command(&_admin_username, add_user1_req) {
        Ok(WorkspaceProtocolResponse::Success(_)) => {
            println!(
                "[Test MultiAdd] User {} added to office {} successfully by admin {}.",
                user1_id, office.id, _admin_username
            );
        }
        Ok(other) => panic!(
            "[Test MultiAdd] AddMember for user1 {} to office {} returned unexpected response: {:?}",
            user1_id, office.id, other
        ),
        Err(e) => panic!(
            "[Test MultiAdd] AddMember for user1 {} to office {} failed: {:?}",
            user1_id, office.id, e
        ),
    }

    // Test adding second user
    let add_user2_req = WorkspaceProtocolRequest::AddMember {
        user_id: user2_id.to_string(),
        office_id: Some(office.id.clone()),
        room_id: None,
        role: UserRole::Member,
        metadata: None,
    };

    match _kernel.process_command(&_admin_username, add_user2_req) {
        Ok(WorkspaceProtocolResponse::Success(_)) => {
            println!(
                "[Test MultiAdd] User {} added to office {} successfully by admin {}.",
                user2_id, office.id, _admin_username
            );
        }
        Ok(other) => panic!(
            "[Test MultiAdd] AddMember for user2 {} to office {} returned unexpected response: {:?}",
            user2_id, office.id, other
        ),
        Err(e) => panic!(
            "[Test MultiAdd] AddMember for user2 {} to office {} failed: {:?}",
            user2_id, office.id, e
        ),
    }

    // Verify both users are in the office
    let get_office_req = WorkspaceProtocolRequest::GetOffice {
        office_id: office.id.clone(),
    };

    let office_details: Office = match _kernel.process_command(&_admin_username, get_office_req) {
        Ok(WorkspaceProtocolResponse::Office(o)) => {
            println!(
                "[Test MultiAdd] Office details for {} retrieved successfully.",
                o.id
            );
            o
        }
        Ok(other) => panic!(
            "[Test MultiAdd] GetOffice for {} returned unexpected response: {:?}",
            office.id, other
        ),
        Err(e) => panic!(
            "[Test MultiAdd] GetOffice for {} failed: {:?}",
            office.id, e
        ),
    };

    assert!(office_details.members.contains(&user1_id.to_string()));
    assert!(office_details.members.contains(&user2_id.to_string()));
    println!("[Test MultiAdd] test_admin_can_add_multiple_users_to_office completed successfully.");
}

#[rstest]
#[tokio::test]
#[timeout(Duration::from_secs(15))]
async fn test_non_admin_cannot_add_user_to_office() {
    let (
        _kernel,
        _internal_service_addr,
        _server_addr,
        _admin_username,
        _admin_password,
        _db_temp_dir,
    ) = setup_test_environment().await.unwrap();

    let owner_id = "owner_for_non_admin_test";
    let non_admin_id = "non_admin_for_test";
    let target_user_id = "target_user_for_non_admin_test";

    let get_workspace_req = WorkspaceProtocolRequest::GetWorkspace;

    match _kernel.process_command(&_admin_username, get_workspace_req) {
        Ok(WorkspaceProtocolResponse::Workspace(_ws_details)) => {
            println!(
                "[Test NonAdmin] Workspace created successfully by actor {}.",
                _admin_username
            );
        }
        Ok(other) => panic!(
            "[Test NonAdmin] CreateWorkspace for {} by actor {} returned unexpected response: {:?}",
            _admin_username, _admin_username, other
        ),
        Err(e) => panic!(
            "[Test NonAdmin] CreateWorkspace for {} by actor {} failed: {:?}",
            _admin_username, _admin_username, e
        ),
    }

    // Inject the necessary users for the test
    _kernel
        .inject_user_for_test(owner_id, UserRole::Member)
        .expect("Failed to inject owner_id for test");
    _kernel
        .inject_user_for_test(non_admin_id, UserRole::Member)
        .expect("Failed to inject non_admin_id for test");
    _kernel
        .inject_user_for_test(target_user_id, UserRole::Member)
        .expect("Failed to inject target_user_id for test");

    let create_office_req = WorkspaceProtocolRequest::CreateOffice {
        workspace_id: WORKSPACE_ROOT_ID.to_string(),
        name: "test_office_non_admin".to_string(),
        description: String::new(),
        mdx_content: None,
        metadata: None,
    };

    let office: Office = match _kernel.process_command(&_admin_username, create_office_req) {
        Ok(WorkspaceProtocolResponse::Office(o)) => {
            println!(
                "[Test NonAdmin] Office {:?} created successfully by actor {}.",
                o.id, _admin_username
            );
            o
        }
        Ok(other) => panic!(
            "[Test NonAdmin] CreateOffice by actor {} returned unexpected response: {:?}",
            _admin_username, other
        ),
        Err(e) => panic!(
            "[Test NonAdmin] CreateOffice by actor {} failed: {:?}",
            _admin_username, e
        ),
    };

    // Add owner to office
    let add_owner_req = WorkspaceProtocolRequest::AddMember {
        user_id: owner_id.to_string(),
        office_id: Some(office.id.clone()),
        room_id: None,
        role: UserRole::Owner,
        metadata: None,
    };

    match _kernel.process_command(&_admin_username, add_owner_req) {
        Ok(WorkspaceProtocolResponse::Success(_)) => {
            println!(
                "[Test NonAdmin] Owner {} added to office {} successfully by admin {}.",
                owner_id, office.id, _admin_username
            );
        }
        Ok(other) => panic!(
            "[Test NonAdmin] AddMember for owner {} by admin {} returned unexpected response: {:?}",
            owner_id, _admin_username, other
        ),
        Err(e) => panic!(
            "[Test NonAdmin] AddMember for owner {} by admin {} failed: {:?}",
            owner_id, _admin_username, e
        ),
    }

    // Add non-admin to office
    let add_non_admin_req = WorkspaceProtocolRequest::AddMember {
        user_id: non_admin_id.to_string(),
        office_id: Some(office.id.clone()),
        room_id: None,
        role: UserRole::Member,
        metadata: None,
    };

    match _kernel.process_command(&_admin_username, add_non_admin_req) {
        Ok(WorkspaceProtocolResponse::Success(_)) => {
            println!("[Test NonAdmin] NonAdmin {} added to office {} successfully by admin {}.", non_admin_id, office.id, _admin_username);
        }
        Ok(other) => panic!("[Test NonAdmin] AddMember for non_admin {} by admin {} returned unexpected response: {:?}", non_admin_id, _admin_username, other),
        Err(e) => panic!("[Test NonAdmin] AddMember for non_admin {} by admin {} failed: {:?}", non_admin_id, _admin_username, e),
    }

    // Test non-admin trying to add a user (should fail)
    let add_target_by_non_admin_req = WorkspaceProtocolRequest::AddMember {
        user_id: target_user_id.to_string(),
        office_id: Some(office.id.clone()),
        room_id: None,
        role: UserRole::Member,
        metadata: None,
    };

    let cmd_result = _kernel.process_command(non_admin_id, add_target_by_non_admin_req);

    println!("[DEBUG RESPONSE] cmd_result = {:?}", cmd_result);

    if let Ok(response) = cmd_result {
        match response {
            WorkspaceProtocolResponse::Error(message) => {
                if (message.to_lowercase().contains("permission denied")
                    || message.to_lowercase().contains("does not have permission")
                    || message
                        .to_lowercase()
                        .contains("does not have admin privileges"))
                    && message.to_lowercase().contains("add users")
                {
                    println!("[Test NonAdmin V9] Successfully caught expected WorkspaceProtocolResponse::Error: {}", message);
                    // Test passes
                } else {
                    panic!("[Test NonAdmin V9] Received WorkspaceProtocolResponse::Error, but not the expected permission denial message. Error: [{}]", message);
                }
            }
            _ => {
                // Any other Ok response variant (like Success, Member, etc.) is unexpected for a failed permission check
                println!("[DEBUG] Received unexpected response: {:?}", response);
                panic!("[Test NonAdmin V9] Command returned an unexpected Ok response variant for non-admin. Expected WorkspaceProtocolResponse::Error. Response: {:?}", response);
            }
        }
    } else if let Err(network_error) = cmd_result {
        // This path is no longer expected for this specific test scenario.
        // The application logic should wrap permission errors into Ok(WorkspaceProtocolResponse::Error(...))
        panic!("[Test NonAdmin V9] Received a direct NetworkError, which is now unexpected. Expected Ok(WorkspaceProtocolResponse::Error(...)). NetworkError: {:?}", network_error);
    }
    println!("[Test NonAdmin] test_non_admin_cannot_add_user_to_office completed successfully.");
}
