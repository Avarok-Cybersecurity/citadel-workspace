use citadel_internal_service_test_common as common;
use citadel_sdk::prelude::*;
use citadel_workspace_server::commands::{UpdateOperation, WorkspaceCommand, WorkspaceResponse};
use citadel_workspace_server::kernel::WorkspaceServerKernel;
use citadel_workspace_server::structs::{Permission, UserRole};
use std::error::Error;
use std::net::SocketAddr;
use std::time::Duration;
use tokio::sync::mpsc::UnboundedReceiver;
use uuid::Uuid;

async fn setup_test_environment() -> Result<(SocketAddr, SocketAddr), Box<dyn Error>> {
    common::setup_log();

    // Setup internal service
    let bind_address_internal_service: SocketAddr = "127.0.0.1:55559".parse().unwrap();

    // Setup workspace server with admin user
    let server_kernel =
        WorkspaceServerKernel::<StackedRatchet>::with_admin("admin", "Administrator");
    let server_bind_address: SocketAddr = "127.0.0.1:55560".parse().unwrap();

    let server = NodeBuilder::default()
        .with_backend(BackendType::InMemory)
        .with_node_type(NodeType::server(server_bind_address)?)
        .with_insecure_skip_cert_verification()
        .build(server_kernel)?;

    tokio::task::spawn(server);

    // Setup internal service
    let internal_service_kernel = citadel_internal_service::kernel::CitadelWorkspaceService::<
        _,
        StackedRatchet,
    >::new_tcp(bind_address_internal_service)
    .await?;
    let internal_service = NodeBuilder::default()
        .with_node_type(NodeType::Peer)
        .with_backend(BackendType::InMemory)
        .with_insecure_skip_cert_verification()
        .build(internal_service_kernel)?;

    tokio::task::spawn(internal_service);

    // Wait for services to start
    tokio::time::sleep(Duration::from_millis(2000)).await;

    Ok((bind_address_internal_service, server_bind_address))
}

async fn register_and_connect_user(
    internal_service_addr: SocketAddr,
    server_addr: SocketAddr,
    username: &str,
    full_name: &str,
) -> Result<
    (
        tokio::sync::mpsc::UnboundedSender<citadel_internal_service_types::InternalServiceRequest>,
        UnboundedReceiver<citadel_internal_service_types::InternalServiceResponse>,
        u64,
    ),
    Box<dyn Error>,
> {
    let to_spawn = vec![common::RegisterAndConnectItems {
        internal_service_addr,
        server_addr,
        full_name,
        username,
        password: "password",
        pre_shared_key: None::<PreSharedKey>,
    }];

    let returned_service_info = common::register_and_connect_to_server(to_spawn).await?;
    let mut service_vec = returned_service_info;

    if let Some(service_handle) = service_vec.pop() {
        Ok(service_handle)
    } else {
        Err("Failed to register and connect user".into())
    }
}

async fn send_workspace_command(
    to_service: &tokio::sync::mpsc::UnboundedSender<
        citadel_internal_service_types::InternalServiceRequest,
    >,
    from_service: &mut UnboundedReceiver<citadel_internal_service_types::InternalServiceResponse>,
    cid: u64,
    command: WorkspaceCommand,
) -> Result<WorkspaceResponse, Box<dyn Error>> {
    let request_id = Uuid::new_v4();
    let serialized_command = serde_json::to_vec(&command)?;

    // Send command to the workspace server
    to_service.send(
        citadel_internal_service_types::InternalServiceRequest::Message {
            cid,
            request_id,
            message: serialized_command,
            peer_cid: None,
            security_level: citadel_internal_service_types::SecurityLevel::Standard,
        },
    )?;

    // Wait for response
    while let Some(response) = from_service.recv().await {
        if let citadel_internal_service_types::InternalServiceResponse::MessageSendSuccess(
            citadel_internal_service_types::MessageSendSuccess {
                request_id: resp_id,
                ..
            },
        ) = &response
        {
            if resp_id.as_ref() == Some(&request_id) {
                continue; // This is just confirmation the message was sent
            }
        }

        if let citadel_internal_service_types::InternalServiceResponse::MessageNotification(
            citadel_internal_service_types::MessageNotification { message, .. },
        ) = response
        {
            // Deserialize the response
            let workspace_response: WorkspaceResponse = serde_json::from_slice(&message)?;
            return Ok(workspace_response);
        }
    }

    Err("No response received".into())
}

async fn create_test_office(
    to_service: &tokio::sync::mpsc::UnboundedSender<
        citadel_internal_service_types::InternalServiceRequest,
    >,
    from_service: &mut UnboundedReceiver<citadel_internal_service_types::InternalServiceResponse>,
    cid: u64,
) -> Result<String, Box<dyn Error>> {
    let create_office_cmd = WorkspaceCommand::CreateOffice {
        name: "Test Office".to_string(),
        description: "A test office".to_string(),
    };

    let response = send_workspace_command(to_service, from_service, cid, create_office_cmd).await?;

    match response {
        WorkspaceResponse::Office(office) => Ok(office.id),
        _ => Err("Expected Office response".into()),
    }
}

async fn create_test_room(
    to_service: &tokio::sync::mpsc::UnboundedSender<
        citadel_internal_service_types::InternalServiceRequest,
    >,
    from_service: &mut UnboundedReceiver<citadel_internal_service_types::InternalServiceResponse>,
    cid: u64,
    office_id: &str,
) -> Result<String, Box<dyn Error>> {
    let create_room_cmd = WorkspaceCommand::CreateRoom {
        office_id: office_id.to_string(),
        name: "Test Room".to_string(),
        description: "A test room".to_string(),
    };

    let response = send_workspace_command(to_service, from_service, cid, create_room_cmd).await?;

    match response {
        WorkspaceResponse::Room(room) => Ok(room.id),
        _ => Err("Expected Room response".into()),
    }
}

#[tokio::test]
async fn test_member_operations() -> Result<(), Box<dyn Error>> {
    let (internal_service_addr, server_addr) = setup_test_environment().await?;

    // Register and connect admin user
    let (admin_to_service, mut admin_from_service, admin_cid) =
        register_and_connect_user(internal_service_addr, server_addr, "admin", "Administrator")
            .await?;

    // Register and connect a regular user (not used in this test but kept for future expansion)
    let (_user_to_service, _user_from_service, _user_cid) =
        register_and_connect_user(internal_service_addr, server_addr, "test_user", "Test User")
            .await?;

    // Create an office as admin
    let office_id =
        create_test_office(&admin_to_service, &mut admin_from_service, admin_cid).await?;

    // Add the regular user to the office with Member role
    let add_member_cmd = WorkspaceCommand::AddMember {
        user_id: "test_user".to_string(),
        office_id: Some(office_id.clone()),
        room_id: None,
        role: UserRole::Member,
    };

    let response = send_workspace_command(
        &admin_to_service,
        &mut admin_from_service,
        admin_cid,
        add_member_cmd,
    )
    .await?;

    match response {
        WorkspaceResponse::Success => {}
        _ => return Err("Expected Success response".into()),
    }

    // List members in the office
    let list_members_cmd = WorkspaceCommand::ListMembers {
        office_id: Some(office_id.clone()),
        room_id: None,
    };

    let response = send_workspace_command(
        &admin_to_service,
        &mut admin_from_service,
        admin_cid,
        list_members_cmd,
    )
    .await?;

    match response {
        WorkspaceResponse::Members(members) => {
            // Should include both admin and test_user
            assert_eq!(members.len(), 2);
            let member_ids: Vec<&str> = members.iter().map(|m| m.id.as_str()).collect();
            assert!(member_ids.contains(&"admin"));
            assert!(member_ids.contains(&"test_user"));
        }
        _ => return Err("Expected Members response".into()),
    }

    // Update member role
    let update_role_cmd = WorkspaceCommand::UpdateMemberRole {
        user_id: "test_user".to_string(),
        role: UserRole::Owner,
    };

    let response = send_workspace_command(
        &admin_to_service,
        &mut admin_from_service,
        admin_cid,
        update_role_cmd,
    )
    .await?;

    match response {
        WorkspaceResponse::Success => {}
        _ => return Err("Expected Success response".into()),
    }

    // Get member to verify role update
    let get_member_cmd = WorkspaceCommand::GetMember {
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
        WorkspaceResponse::Member(member) => {
            assert_eq!(member.id, "test_user");
            assert!(matches!(member.role, UserRole::Owner));
        }
        _ => return Err("Expected Member response".into()),
    }

    // Create a room in the office (not used in this test but kept for future expansion)
    let _room_id = create_test_room(
        &admin_to_service,
        &mut admin_from_service,
        admin_cid,
        &office_id,
    )
    .await?;

    // Remove member from the office
    let remove_member_cmd = WorkspaceCommand::RemoveMember {
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
        WorkspaceResponse::Success => {}
        _ => return Err("Expected Success response".into()),
    }

    // Verify member was removed
    let list_members_cmd = WorkspaceCommand::ListMembers {
        office_id: Some(office_id),
        room_id: None,
    };

    let response = send_workspace_command(
        &admin_to_service,
        &mut admin_from_service,
        admin_cid,
        list_members_cmd,
    )
    .await?;

    match response {
        WorkspaceResponse::Members(members) => {
            // Should only include admin now
            assert_eq!(members.len(), 1);
            assert_eq!(members[0].id, "admin");
        }
        _ => return Err("Expected Members response".into()),
    }

    Ok(())
}

#[tokio::test]
async fn test_permission_operations() -> Result<(), Box<dyn Error>> {
    let (internal_service_addr, server_addr) = setup_test_environment().await?;

    // Register and connect admin user
    let (admin_to_service, mut admin_from_service, admin_cid) =
        register_and_connect_user(internal_service_addr, server_addr, "admin", "Administrator")
            .await?;

    // Register and connect a regular user (not used in this test but kept for future expansion)
    let (_user_to_service, _user_from_service, _user_cid) =
        register_and_connect_user(internal_service_addr, server_addr, "test_user", "Test User")
            .await?;

    // Create an office as admin
    let office_id =
        create_test_office(&admin_to_service, &mut admin_from_service, admin_cid).await?;

    // Add the regular user to the office with Member role
    let add_member_cmd = WorkspaceCommand::AddMember {
        user_id: "test_user".to_string(),
        office_id: Some(office_id.clone()),
        room_id: None,
        role: UserRole::Member,
    };

    let response = send_workspace_command(
        &admin_to_service,
        &mut admin_from_service,
        admin_cid,
        add_member_cmd,
    )
    .await?;

    match response {
        WorkspaceResponse::Success => {}
        _ => return Err("Expected Success response".into()),
    }

    // Update member permissions
    let update_permissions_cmd = WorkspaceCommand::UpdateMemberPermissions {
        user_id: "test_user".to_string(),
        domain_id: office_id.clone(),
        permissions: vec![Permission::EditMdx, Permission::ManageUsers],
        operation: UpdateOperation::Add,
    };

    let response = send_workspace_command(
        &admin_to_service,
        &mut admin_from_service,
        admin_cid,
        update_permissions_cmd,
    )
    .await?;

    match response {
        WorkspaceResponse::Success => {}
        _ => return Err("Expected Success response".into()),
    }

    // Get member to verify permissions update
    let get_member_cmd = WorkspaceCommand::GetMember {
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
        WorkspaceResponse::Member(member) => {
            assert_eq!(member.id, "test_user");

            // Check if the user has the added permissions
            let domain_permissions = member
                .permissions
                .get(&office_id)
                .expect("Domain permissions not found");
            assert!(domain_permissions.contains(&Permission::EditMdx));
            assert!(domain_permissions.contains(&Permission::ManageUsers));
        }
        _ => return Err("Expected Member response".into()),
    }

    // Remove a permission
    let remove_permission_cmd = WorkspaceCommand::UpdateMemberPermissions {
        user_id: "test_user".to_string(),
        domain_id: office_id.clone(),
        permissions: vec![Permission::ManageUsers],
        operation: UpdateOperation::Remove,
    };

    let response = send_workspace_command(
        &admin_to_service,
        &mut admin_from_service,
        admin_cid,
        remove_permission_cmd,
    )
    .await?;

    match response {
        WorkspaceResponse::Success => {}
        _ => return Err("Expected Success response".into()),
    }

    // Get member to verify permissions update
    let get_member_cmd = WorkspaceCommand::GetMember {
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
        WorkspaceResponse::Member(member) => {
            assert_eq!(member.id, "test_user");

            // Check if the permission was removed
            let domain_permissions = member
                .permissions
                .get(&office_id)
                .expect("Domain permissions not found");
            assert!(domain_permissions.contains(&Permission::EditMdx));
            assert!(!domain_permissions.contains(&Permission::ManageUsers));
        }
        _ => return Err("Expected Member response".into()),
    }

    // Replace all permissions
    let replace_permissions_cmd = WorkspaceCommand::UpdateMemberPermissions {
        user_id: "test_user".to_string(),
        domain_id: office_id.clone(),
        permissions: vec![Permission::ReadMessages, Permission::SendMessages],
        operation: UpdateOperation::Set,
    };

    let response = send_workspace_command(
        &admin_to_service,
        &mut admin_from_service,
        admin_cid,
        replace_permissions_cmd,
    )
    .await?;

    match response {
        WorkspaceResponse::Success => {}
        _ => return Err("Expected Success response".into()),
    }

    // Get member to verify permissions update
    let get_member_cmd = WorkspaceCommand::GetMember {
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
        WorkspaceResponse::Member(member) => {
            assert_eq!(member.id, "test_user");

            // Check if permissions were completely replaced
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

    Ok(())
}

#[tokio::test]
async fn test_custom_role_operations() -> Result<(), Box<dyn Error>> {
    let (internal_service_addr, server_addr) = setup_test_environment().await?;

    // Register and connect admin user
    let (admin_to_service, mut admin_from_service, admin_cid) =
        register_and_connect_user(internal_service_addr, server_addr, "admin", "Administrator")
            .await?;

    // Register and connect a regular user (not used in this test but kept for future expansion)
    let (_user_to_service, _user_from_service, _user_cid) =
        register_and_connect_user(internal_service_addr, server_addr, "test_user", "Test User")
            .await?;

    // Create an office as admin
    let office_id =
        create_test_office(&admin_to_service, &mut admin_from_service, admin_cid).await?;

    // Create a custom role for the user
    let custom_role = UserRole::Custom {
        name: "Editor".to_string(),
        rank: 16,
    };

    // Add the regular user to the office with custom role
    let add_member_cmd = WorkspaceCommand::AddMember {
        user_id: "test_user".to_string(),
        office_id: Some(office_id.clone()),
        room_id: None,
        role: custom_role,
    };

    let response = send_workspace_command(
        &admin_to_service,
        &mut admin_from_service,
        admin_cid,
        add_member_cmd,
    )
    .await?;

    match response {
        WorkspaceResponse::Success => {}
        _ => return Err("Expected Success response".into()),
    }

    // Get member to verify custom role
    let get_member_cmd = WorkspaceCommand::GetMember {
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
        WorkspaceResponse::Member(member) => {
            assert_eq!(member.id, "test_user");

            // Check if the user has the custom role
            if let UserRole::Custom { name, rank } = &member.role {
                assert_eq!(name, "Editor");
                assert_eq!(*rank, 16);
            } else {
                return Err("Expected custom role".into());
            }

            // Check if the user has the permissions associated with the custom role
            let domain_permissions = member
                .permissions
                .get(&office_id)
                .expect("Domain permissions not found");
            assert!(domain_permissions.contains(&Permission::ReadMessages));
            assert!(domain_permissions.contains(&Permission::SendMessages));
            assert!(domain_permissions.contains(&Permission::EditMdx));
        }
        _ => return Err("Expected Member response".into()),
    }

    Ok(())
}
