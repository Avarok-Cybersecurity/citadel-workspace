use citadel_internal_service::kernel::CitadelWorkspaceService;
use citadel_internal_service_test_common::get_free_port;
use citadel_internal_service_test_common::{
    self as common, server_test_node_skip_cert_verification,
};
use citadel_logging::info;
use citadel_sdk::prelude::*;
use citadel_workspace_server_kernel::handlers::domain::DomainOperations;
use citadel_workspace_server_kernel::kernel::WorkspaceServerKernel;
use citadel_workspace_server_kernel::WORKSPACE_ROOT_ID; // Corrected constants import
use citadel_workspace_types::structs::{Office, Permission, UserRole};
use citadel_workspace_types::{
    UpdateOperation, WorkspaceProtocolPayload, WorkspaceProtocolRequest, WorkspaceProtocolResponse,
};
use rocksdb::DB;
use rstest::rstest;
use serde_json;
use std::error::Error;
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;
use tempfile::TempDir;
use tokio::sync::mpsc::UnboundedReceiver;
use tokio::task::JoinHandle;
use uuid::Uuid;

const ADMIN_ID: &str = "admin";

async fn new_internal_service_with_admin(
    bind_address_internal_service: SocketAddr,
) -> Result<
    (
        JoinHandle<
            Result<
                CitadelWorkspaceService<
                    citadel_internal_service_connector::io_interface::tcp::TcpIOInterface,
                    StackedRatchet,
                >,
                NetworkError,
            >,
        >,
        String,
        String,
    ),
    Box<dyn Error>,
> {
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

    let service_handle = tokio::task::spawn(internal_service);

    tokio::time::sleep(std::time::Duration::from_millis(100)).await;

    let admin_password = Uuid::new_v4().to_string();

    Ok((service_handle, ADMIN_ID.to_string(), admin_password))
}

async fn setup_test_environment() -> Result<
    (
        WorkspaceServerKernel<StackedRatchet>,
        SocketAddr,
        SocketAddr,
        String,
        String,
        TempDir,
    ),
    Box<dyn Error>,
> {
    common::setup_log();

    let temp_db_dir = TempDir::new()?;
    let db = Arc::new(DB::open_default(temp_db_dir.path())?);

    let bind_address_internal_service: SocketAddr =
        format!("127.0.0.1:{}", get_free_port()).parse().unwrap();

    let (_internal_service, admin_username, admin_password) =
        new_internal_service_with_admin(bind_address_internal_service).await?;

    let workspace_kernel = WorkspaceServerKernel::<StackedRatchet>::with_admin(
        ADMIN_ID,
        &admin_username,
        &admin_password,
        db.clone(),
    );

    let (server, server_bind_address) =
        server_test_node_skip_cert_verification(workspace_kernel.clone(), |_| ());

    tokio::task::spawn(server);

    tokio::time::sleep(Duration::from_millis(2000)).await;

    Ok((
        workspace_kernel,
        bind_address_internal_service,
        server_bind_address,
        admin_username,
        admin_password,
        temp_db_dir,
    ))
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
    command: WorkspaceProtocolRequest,
) -> Result<WorkspaceProtocolResponse, Box<dyn Error>> {
    let request_id = Uuid::new_v4();
    let payload = WorkspaceProtocolPayload::Request(command);
    let serialized_command =
        serde_json::to_vec(&payload).map_err(|e| Box::new(e) as Box<dyn Error>)?;

    to_service.send(
        citadel_internal_service_types::InternalServiceRequest::Message {
            cid,
            request_id,
            message: serialized_command,
            peer_cid: None,
            security_level: citadel_internal_service_types::SecurityLevel::Standard,
        },
    )?;

    info!(target: "citadel", "Sent command: {payload:?} with request_id: {request_id}");

    while let Some(response) = from_service.recv().await {
        if let citadel_internal_service_types::InternalServiceResponse::MessageSendSuccess(
            citadel_internal_service_types::MessageSendSuccess {
                request_id: resp_id,
                ..
            },
        ) = &response
        {
            if resp_id.as_ref() == Some(&request_id) {
                info!(target: "citadel", "Received confirmation that message was sent successfully");
                continue;
            }
        }

        if let citadel_internal_service_types::InternalServiceResponse::MessageNotification(
            citadel_internal_service_types::MessageNotification { message, .. },
        ) = &response
        {
            info!(target: "citadel", "Received response: {response:?}");
            let response: WorkspaceProtocolPayload =
                serde_json::from_slice(message).map_err(|e| Box::new(e) as Box<dyn Error>)?;
            let WorkspaceProtocolPayload::Response(response) = response else {
                panic!("Expected WorkspaceProtocolPayload::Response")
            };
            return Ok(response);
        }
    }

    Err("No response received".into())
}

async fn create_test_room(
    to_service: &tokio::sync::mpsc::UnboundedSender<
        citadel_internal_service_types::InternalServiceRequest,
    >,
    from_service: &mut UnboundedReceiver<citadel_internal_service_types::InternalServiceResponse>,
    cid: u64,
    office_id: &str,
) -> Result<String, Box<dyn Error>> {
    info!(target: "citadel", "Creating test room...");
    let create_room_cmd = WorkspaceProtocolRequest::CreateRoom {
        office_id: office_id.to_string(),
        name: "Test Room".to_string(),
        description: "A test room".to_string(),
        mdx_content: Some("# Test Room MDX\nTest room content for integration tests".to_string()),
        metadata: None,
    };

    let response = send_workspace_command(to_service, from_service, cid, create_room_cmd).await?;

    match response {
        WorkspaceProtocolResponse::Room(room) => {
            info!(target: "citadel", "Test room created with ID: {}", room.id);
            Ok(room.id)
        }
        _ => Err("Expected Room response".into()),
    }
}

#[tokio::test]
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

    let create_workspace_cmd = WorkspaceProtocolRequest::CreateWorkspace {
        name: "Root Workspace".to_string(),
        description: "Root workspace for the system".to_string(),
        metadata: None,
        workspace_master_password: admin_password.clone(),
    };

    let workspace_response = send_workspace_command(
        &admin_to_service,
        &mut admin_from_service,
        admin_cid,
        create_workspace_cmd,
    )
    .await?;
    let root_workspace_id = match workspace_response {
        WorkspaceProtocolResponse::Workspace(workspace) => workspace.id,
        _ => return Err("Expected Workspace response for root workspace creation".into()),
    };

    let (_user_to_service, _user_from_service, _user_cid) =
        register_and_connect_user(internal_service_addr, server_addr, "test_user", "Test User")
            .await?;

    workspace_kernel
        .inject_admin_user("test_user", "Test User", &admin_password)
        .unwrap();

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

    workspace_kernel
        .add_member(ADMIN_ID, ADMIN_ID, Some(&office_id), UserRole::Admin, None)
        .map_err(|e| {
            eprintln!(
                "ADMIN_ID add_member to office_id {} FAILED at line 300: {:?}",
                office_id, e
            );
            e
        })
        .unwrap();

    workspace_kernel
        .add_member(
            ADMIN_ID,
            "test_user",
            Some(&office_id),
            UserRole::Member,
            None,
        )
        .map_err(|e| {
            eprintln!(
                "add_member failed at line 300 for office_id {}: {:?}",
                office_id, e
            );
            e
        })
        .unwrap();

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

    let office_details_result = workspace_kernel.get_office("test_user", &office_id);
    let office_details_after_add = match office_details_result {
        Ok(office_struct) => office_struct,
        Err(e) => panic!("[Test] get_office failed: {:?}", e),
    };

    assert!(office_details_after_add
        .members
        .contains(&"test_user".to_string()));

    println!("[Test] test_member_operations completed successfully.");
    Ok(())
}

#[tokio::test]
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

    let create_workspace_cmd = WorkspaceProtocolRequest::CreateWorkspace {
        name: "Root Workspace".to_string(),
        description: "Root workspace for the system".to_string(),
        metadata: None,
        workspace_master_password: admin_password.clone(),
    };

    let workspace_response = send_workspace_command(
        &admin_to_service,
        &mut admin_from_service,
        admin_cid,
        create_workspace_cmd,
    )
    .await?;
    let root_workspace_id = match workspace_response {
        WorkspaceProtocolResponse::Workspace(workspace) => workspace.id,
        _ => return Err("Expected Workspace response for root workspace creation".into()),
    };

    let (_user_to_service, _user_from_service, _user_cid) =
        register_and_connect_user(internal_service_addr, server_addr, "test_user", "Test User")
            .await?;

    workspace_kernel
        .inject_admin_user("test_user", "Test User", &admin_password)
        .unwrap();

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

    workspace_kernel
        .add_member(ADMIN_ID, ADMIN_ID, Some(&office_id), UserRole::Admin, None)
        .map_err(|e| {
            eprintln!(
                "ADMIN_ID add_member to office_id {} FAILED at line 588: {:?}",
                office_id, e
            );
            e
        })
        .unwrap();

    workspace_kernel
        .add_member(
            ADMIN_ID,
            "test_user",
            Some(&office_id),
            UserRole::Member,
            None,
        )
        .unwrap();

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

    Ok(())
}

#[tokio::test]
async fn test_custom_role_operations() -> Result<(), Box<dyn Error>> {
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
        .inject_admin_user(&admin_username, "Admin", &admin_password)
        .unwrap();

    let create_workspace_cmd = WorkspaceProtocolRequest::CreateWorkspace {
        name: "Root Workspace".to_string(),
        description: "Root workspace for the system".to_string(),
        metadata: None,
        workspace_master_password: admin_password.clone(),
    };

    let workspace_response = send_workspace_command(
        &admin_to_service,
        &mut admin_from_service,
        admin_cid,
        create_workspace_cmd,
    )
    .await?;
    let root_workspace_id = match workspace_response {
        WorkspaceProtocolResponse::Workspace(workspace) => workspace.id,
        _ => return Err("Expected Workspace response for root workspace creation".into()),
    };

    let (_user_to_service, _user_from_service, _user_cid) =
        register_and_connect_user(internal_service_addr, server_addr, "test_user", "Test User")
            .await?;

    workspace_kernel
        .inject_admin_user("test_user", "Test User", &admin_password)
        .unwrap();

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

    workspace_kernel
        .add_member(ADMIN_ID, ADMIN_ID, Some(&office_id), UserRole::Admin, None)
        .map_err(|e| {
            eprintln!(
                "ADMIN_ID add_member to office_id {} FAILED at line 887: {:?}",
                office_id, e
            );
            e
        })
        .unwrap();

    let custom_role = UserRole::Custom("Editor".to_string(), 16);

    let add_member_cmd = WorkspaceProtocolRequest::AddMember {
        user_id: "test_user".to_string(),
        office_id: Some(office_id.clone()),
        room_id: None,
        role: custom_role,
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
        WorkspaceProtocolResponse::Success(_) => println!("User added successfully"),
        _ => return Err("Expected Success response".into()),
    }

    let update_permissions_cmd = WorkspaceProtocolRequest::UpdateMemberPermissions {
        user_id: "test_user".to_string(),
        domain_id: office_id.clone(),
        permissions: vec![Permission::EditMdx, Permission::EditOfficeConfig],
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
        WorkspaceProtocolResponse::Success(_) => println!("Permissions added successfully"),
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

            if let UserRole::Custom(name, rank) = &member.role {
                assert_eq!(name, "Editor");
                assert_eq!(*rank, 16);
            } else {
                return Err("Expected custom role".into());
            }

            let domain_permissions = member
                .permissions
                .get(&office_id)
                .expect("Domain permissions not found");
            println!("Domain permissions: {domain_permissions:?}");

            assert!(domain_permissions.contains(&Permission::ViewContent));

            assert!(domain_permissions.contains(&Permission::EditMdx));
            assert!(domain_permissions.contains(&Permission::EditOfficeConfig));
        }
        _ => return Err("Expected Member response".into()),
    }

    Ok(())
}

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
    let (
        _kernel,
        _internal_service_addr,
        _server_addr,
        _admin_username,
        _admin_password,
        _db_temp_dir,
    ) = setup_test_environment().await.unwrap();

    let create_workspace_req = WorkspaceProtocolRequest::CreateWorkspace {
        name: "test_workspace_non_admin".to_string(),
        description: String::new(),
        metadata: None,
        workspace_master_password: "password".to_string(),
    };

    match _kernel.process_command(&_admin_username, create_workspace_req) {
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

    let create_office_req = WorkspaceProtocolRequest::CreateOffice {
        workspace_id: WORKSPACE_ROOT_ID.to_string(),
        name: "test_office".to_string(),
        description: String::new(),
        mdx_content: None,
        metadata: None,
    };

    let office: Office = match _kernel.process_command(&_admin_username, create_office_req) {
        Ok(WorkspaceProtocolResponse::Office(o)) => {
            println!("[Test MultiAdd] Office {:?} created successfully.", o.id);
            o
        }
        Ok(other) => panic!(
            "[Test MultiAdd] CreateOffice returned unexpected response: {:?}",
            other
        ),
        Err(e) => panic!("[Test MultiAdd] CreateOffice failed: {:?}", e),
    };

    let user1_id = "user1_multi_add";
    let user2_id = "user2_multi_add";

    let add_member1_req = WorkspaceProtocolRequest::AddMember {
        user_id: user1_id.to_string(),
        office_id: Some(office.id.clone()),
        room_id: None,
        role: UserRole::Member,
        metadata: None,
    };

    match _kernel.process_command(&_admin_username, add_member1_req) {
        Ok(WorkspaceProtocolResponse::Success(_)) => {
            println!("[Test MultiAdd] User1 {} added to office {} successfully.", user1_id, office.id);
        }
        Ok(other) => panic!("[Test MultiAdd] AddMember for user1 {} to office {} returned unexpected response: {:?}", user1_id, office.id, other),
        Err(e) => panic!("[Test MultiAdd] AddMember for user1 {} to office {} failed: {:?}", user1_id, office.id, e),
    }

    let add_member2_req = WorkspaceProtocolRequest::AddMember {
        user_id: user2_id.to_string(),
        office_id: Some(office.id.clone()),
        room_id: None,
        role: UserRole::Member,
        metadata: None,
    };

    match _kernel.process_command(&_admin_username, add_member2_req) {
        Ok(WorkspaceProtocolResponse::Success(_)) => {
            println!("[Test MultiAdd] User2 {} added to office {} successfully.", user2_id, office.id);
        }
        Ok(other) => panic!("[Test MultiAdd] AddMember for user2 {} to office {} returned unexpected response: {:?}", user2_id, office.id, other),
        Err(e) => panic!("[Test MultiAdd] AddMember for user2 {} to office {} failed: {:?}", user2_id, office.id, e),
    }

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
    let workspace_id = "ws_for_non_admin_test";

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

    let create_workspace_req = WorkspaceProtocolRequest::CreateWorkspace {
        name: "Workspace NonAdmin".to_string(),
        description: String::new(),
        metadata: None,
        workspace_master_password: "password".to_string(),
    };

    match _kernel.process_command(&_admin_username, create_workspace_req) {
        Ok(WorkspaceProtocolResponse::Workspace(_)) => {
            println!(
                "[Test NonAdmin] Workspace {} created successfully by actor {}.",
                workspace_id, _admin_username
            );
        }
        Ok(other) => panic!(
            "[Test NonAdmin] CreateWorkspace for {} by actor {} returned unexpected response: {:?}",
            workspace_id, _admin_username, other
        ),
        Err(e) => panic!(
            "[Test NonAdmin] CreateWorkspace for {} by actor {} failed: {:?}",
            workspace_id, _admin_username, e
        ),
    }

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

    let add_target_by_non_admin_req = WorkspaceProtocolRequest::AddMember {
        user_id: target_user_id.to_string(),
        office_id: Some(office.id.clone()),
        room_id: None,
        role: UserRole::Member,
        metadata: None,
    };

    let cmd_result = _kernel.process_command(&non_admin_id, add_target_by_non_admin_req);

    if let Ok(response) = cmd_result {
        match response {
            WorkspaceProtocolResponse::Error(message) => {
                if message.to_lowercase().contains("permission denied")
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
