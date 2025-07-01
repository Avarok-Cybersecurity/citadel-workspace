mod common;

use common::member_test_utils::*;
use rstest::rstest;
use std::error::Error;
use std::time::Duration;
use tokio::time::timeout;

use citadel_workspace_server_kernel::kernel::transaction::{Transaction, TransactionManagerExt};
use citadel_workspace_server_kernel::WORKSPACE_ROOT_ID;
use citadel_workspace_types::structs::{Permission, User, UserRole};
use citadel_workspace_types::{
    UpdateOperation, WorkspaceProtocolRequest, WorkspaceProtocolResponse,
};

#[rstest]
#[tokio::test]
#[timeout(Duration::from_secs(30))]
async fn test_permission_operations() -> Result<(), Box<dyn Error>> {
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

    let _room_id = create_test_room(
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
        WorkspaceProtocolResponse::Success(_) => println!("Test user added to office"),
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
            assert_eq!(member.id, "test_user");

            let domain_permissions = member
                .permissions
                .get(&office_id)
                .expect("Domain permissions not found");
            println!("Domain permissions: {domain_permissions:?}");

            assert!(domain_permissions.contains(&Permission::ViewContent));

            assert!(!domain_permissions.contains(&Permission::EditMdx));
            assert!(!domain_permissions.contains(&Permission::EditOfficeConfig));
        }
        _ => return Err("Expected Member response".into()),
    }

    // Test adding permissions
    let add_permission_cmd = WorkspaceProtocolRequest::UpdateMemberPermissions {
        user_id: "test_user".to_string(),
        domain_id: office_id.clone(),
        operation: UpdateOperation::Add,
        permissions: vec![Permission::ManageDomains],
    };

    let response = send_workspace_command(
        &admin_to_service,
        &mut admin_from_service,
        admin_cid,
        add_permission_cmd,
    )
    .await?;

    match response {
        WorkspaceProtocolResponse::Success(_) => println!("Permission added"),
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
            assert_eq!(member.id, "test_user");

            let domain_permissions = member
                .permissions
                .get(&office_id)
                .expect("Domain permissions not found");
            assert!(domain_permissions.contains(&Permission::ManageDomains));
        }
        _ => return Err("Expected Member response".into()),
    }

    // Test removing permissions
    let remove_permission_cmd = WorkspaceProtocolRequest::UpdateMemberPermissions {
        user_id: "test_user".to_string(),
        domain_id: office_id.clone(),
        operation: UpdateOperation::Remove,
        permissions: vec![Permission::EditMdx],
    };

    let response = send_workspace_command(
        &admin_to_service,
        &mut admin_from_service,
        admin_cid,
        remove_permission_cmd,
    )
    .await?;

    match response {
        WorkspaceProtocolResponse::Success(_) => println!("Permission removed"),
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
            assert_eq!(member.id, "test_user");

            let domain_permissions = member
                .permissions
                .get(&office_id)
                .expect("Domain permissions not found");
            assert!(!domain_permissions.contains(&Permission::EditMdx));
        }
        _ => return Err("Expected Member response".into()),
    }

    // Test replacing permissions
    let replace_permissions_cmd = WorkspaceProtocolRequest::UpdateMemberPermissions {
        user_id: "test_user".to_string(),
        domain_id: office_id.clone(),
        operation: UpdateOperation::Set,
        permissions: vec![Permission::ReadMessages, Permission::SendMessages],
    };

    let response = send_workspace_command(
        &admin_to_service,
        &mut admin_from_service,
        admin_cid,
        replace_permissions_cmd,
    )
    .await?;

    match response {
        WorkspaceProtocolResponse::Success(_) => println!("Permissions replaced"),
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
            assert_eq!(member.id, "test_user");

            let domain_permissions = member
                .permissions
                .get(&office_id)
                .expect("Domain permissions not found");
            assert_eq!(domain_permissions.len(), 2);
            assert!(domain_permissions.contains(&Permission::ReadMessages));
            assert!(domain_permissions.contains(&Permission::SendMessages));
            assert!(!domain_permissions.contains(&Permission::EditMdx));
        }
        _ => return Err("Expected Member response".into()),
    }

    println!("[Test] test_permission_operations completed successfully.");
    Ok(())
}
