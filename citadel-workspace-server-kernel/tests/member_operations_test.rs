#[path = "common/mod.rs"] mod common;
use citadel_workspace_server_kernel::handlers::domain::{OfficeOperations, RoomOperations, UserManagementOperations};

use common::member_test_utils::*;
use rstest::rstest;
use std::error::Error;
use std::time::Duration;
use tokio::time::timeout;

use citadel_logging::info;
use citadel_workspace_server_kernel::handlers::domain::DomainOperations;
use citadel_workspace_server_kernel::kernel::transaction::{Transaction, TransactionManagerExt};
use citadel_workspace_server_kernel::WORKSPACE_ROOT_ID;
use citadel_workspace_types::structs::{Permission, User, UserRole};
use citadel_workspace_types::{
    UpdateOperation, WorkspaceProtocolRequest, WorkspaceProtocolResponse,
};

#[rstest]
#[tokio::test]
#[timeout(Duration::from_secs(30))]
async fn test_member_operations() -> Result<(), Box<dyn Error>> {
    let (
        workspace_kernel,
        internal_service_addr,
        server_addr,
        admin_username,
        admin_password,
        _temp_db_dir,
    ) = setup_test_environment().await?;

    let (admin_to_service, mut admin_from_service, admin_cid) = register_and_connect_user(
        internal_service_addr,
        server_addr,
        &admin_username,
        "Administrator",
    )
    .await?;

    workspace_kernel
        .inject_admin_user(&admin_username, "Connected Admin", &admin_password)
        .unwrap();

    let root_workspace_id = WORKSPACE_ROOT_ID.to_string();

    let (_user_to_service, _user_from_service, _user_cid) =
        register_and_connect_user(internal_service_addr, server_addr, "test_user", "Test User")
            .await?;

    // Create a regular user instead of admin user
    workspace_kernel.tx_manager().with_write_transaction(|tx| {
        let user = User::new(
            "test_user".to_string(),
            "Test User".to_string(),
            UserRole::Member,
        );
        tx.insert_user("test_user".to_string(), user)
    })?;

    // Add the user to the workspace first so they remain a workspace member after office removal
    let add_workspace_member_cmd = WorkspaceProtocolRequest::AddMember {
        user_id: "test_user".to_string(),
        office_id: None,
        room_id: None,
        role: UserRole::Member,
        metadata: Some("workspace_metadata".to_string().into_bytes()),
    };

    let response = send_workspace_command(
        &admin_to_service,
        &mut admin_from_service,
        admin_cid,
        add_workspace_member_cmd,
    )
    .await?;

    match response {
        WorkspaceProtocolResponse::Success(_) => {
            println!("Test user added to workspace");
        }
        _ => return Err("Expected Success response for workspace member addition".into()),
    }

    let office_result = workspace_kernel
        .create_office(
            ADMIN_ID,
            &root_workspace_id,
            "Test Office",
            "A test office",
            None,
        )
        .map_err(|e| Box::<dyn Error>::from(format!("Failed to create office: {}", e)));
    let office_from_kernel = office_result.unwrap();
    let office_id = office_from_kernel.id.clone();

    let room_id = create_test_room(
        &admin_to_service,
        &mut admin_from_service,
        admin_cid,
        &office_id,
    )
    .await?;

    let add_member_cmd = WorkspaceProtocolRequest::AddMember {
        user_id: "test_user".to_string(),
        office_id: Some(office_id.clone()),
        room_id: None,
        role: UserRole::Member,
        metadata: Some("test_metadata".to_string().into_bytes()),
    };

    let response = send_workspace_command(
        &admin_to_service,
        &mut admin_from_service,
        admin_cid,
        add_member_cmd,
    )
    .await?;

    match response {
        WorkspaceProtocolResponse::Success(_) => {
            info!(
                "[Test] Admin successfully added test_user to office {}",
                office_id
            );
        }
        _ => {
            return Err(format!(
                "[Test] Failed to add test_user to office {}. Response: {:?}",
                office_id, response
            )
            .into());
        }
    }

    workspace_kernel
        .domain_operations
        .update_member_permissions(
            ADMIN_ID,                      // actor_user_id (admin)
            "test_user",                   // target_user_id
            &office_id,                    // domain_id
            vec![Permission::ViewContent], // permissions to add
            UpdateOperation::Add,          // operation
        )?;

    let get_member_cmd = WorkspaceProtocolRequest::GetMember {
        user_id: "test_user".to_string(),
    };

    let response = send_workspace_command(
        &admin_to_service,
        &mut admin_from_service,
        admin_cid,
        get_member_cmd,
    )
    .await?;

    match response {
        WorkspaceProtocolResponse::Member(member) => {
            println!("Verified test user is in office");
            assert_eq!(member.id, "test_user");
            assert!(member.is_member_of_domain(office_id.clone()));
            assert_eq!(member.role, UserRole::Member);
        }
        _ => return Err("Expected Member response".into()),
    }

    let add_room_member_cmd = WorkspaceProtocolRequest::AddMember {
        user_id: "test_user".to_string(),
        office_id: None,
        room_id: Some(room_id.clone()),
        role: UserRole::Member,
        metadata: Some("test_metadata".to_string().into_bytes()),
    };

    let response = send_workspace_command(
        &admin_to_service,
        &mut admin_from_service,
        admin_cid,
        add_room_member_cmd,
    )
    .await?;

    match response {
        WorkspaceProtocolResponse::Success(_) => {
            println!("Test user added to room");
        }
        _ => return Err("Expected Success response".into()),
    }

    let get_room_cmd = WorkspaceProtocolRequest::GetRoom {
        room_id: room_id.clone(),
    };

    let response = send_workspace_command(
        &admin_to_service,
        &mut admin_from_service,
        admin_cid,
        get_room_cmd,
    )
    .await?;

    match response {
        WorkspaceProtocolResponse::Room(room) => {
            println!("Verified test user is in room");
            assert!(room.members.contains(&"test_user".to_string()));
        }
        _ => return Err("Expected Room response".into()),
    }

    let remove_room_member_cmd = WorkspaceProtocolRequest::RemoveMember {
        user_id: "test_user".to_string(),
        office_id: None,
        room_id: Some(room_id.clone()),
    };

    let response = send_workspace_command(
        &admin_to_service,
        &mut admin_from_service,
        admin_cid,
        remove_room_member_cmd,
    )
    .await?;

    match response {
        WorkspaceProtocolResponse::Success(_) => {
            println!("Test user removed from room");
        }
        _ => return Err("Expected Success response".into()),
    }

    let get_room_cmd = WorkspaceProtocolRequest::GetRoom {
        room_id: room_id.clone(),
    };

    let response = send_workspace_command(
        &admin_to_service,
        &mut admin_from_service,
        admin_cid,
        get_room_cmd,
    )
    .await?;

    match response {
        WorkspaceProtocolResponse::Room(room) => {
            println!("Verified test user is not in room");
            assert!(!room.members.contains(&"test_user".to_string()));
        }
        _ => return Err("Expected Room response".into()),
    }

    let remove_member_cmd = WorkspaceProtocolRequest::RemoveMember {
        user_id: "test_user".to_string(),
        office_id: Some(office_id.clone()),
        room_id: None,
    };

    let response = send_workspace_command(
        &admin_to_service,
        &mut admin_from_service,
        admin_cid,
        remove_member_cmd,
    )
    .await?;

    match response {
        WorkspaceProtocolResponse::Success(_) => {
            println!("Test user removed from office");
        }
        _ => return Err("Expected Success response".into()),
    }

    let get_member_cmd = WorkspaceProtocolRequest::GetMember {
        user_id: "test_user".to_string(),
    };

    let response = send_workspace_command(
        &admin_to_service,
        &mut admin_from_service,
        admin_cid,
        get_member_cmd,
    )
    .await?;

    match response {
        WorkspaceProtocolResponse::Member(member) => {
            println!("Verified test user is not in office");
            assert_eq!(member.id, "test_user");
            assert!(!member.is_member_of_domain(&office_id));
        }
        _ => return Err("Expected Member response".into()),
    }

    let office_details_result_for_removed_user =
        workspace_kernel.get_office("test_user", &office_id);
    assert!(
        office_details_result_for_removed_user.is_ok(),
        "Expected get_office to succeed for workspace member (even if removed from office's direct members), but got: {:?}",
        office_details_result_for_removed_user
    );

    println!("[Test] test_member_operations completed successfully.");
    Ok(())
}
