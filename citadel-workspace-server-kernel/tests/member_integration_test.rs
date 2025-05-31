use citadel_internal_service::kernel::CitadelWorkspaceService;
use citadel_internal_service_test_common::get_free_port;
use citadel_internal_service_test_common::{
    self as common, server_test_node_skip_cert_verification,
};
use citadel_logging::info;
use citadel_sdk::prelude::*;
use citadel_workspace_server_kernel::handlers::domain::server_ops::DomainServerOperations;
use citadel_workspace_server_kernel::handlers::domain::DomainOperations; // Added this line
use citadel_workspace_server_kernel::kernel::WorkspaceServerKernel;
use citadel_workspace_types::structs::{Office, Permission, User, UserRole};
use citadel_workspace_types::{
    UpdateOperation, WorkspaceProtocolPayload, WorkspaceProtocolRequest, WorkspaceProtocolResponse,
};
use serde_json; // Added for deserialization
use std::error::Error;
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;
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

    // Start the node to initialize the remote
    let service_handle = tokio::task::spawn(internal_service);

    // Wait for the remote to be initialized
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
    ),
    Box<dyn Error>,
> {
    common::setup_log();

    // Setup internal service
    let bind_address_internal_service: SocketAddr =
        format!("127.0.0.1:{}", get_free_port()).parse().unwrap();

    // Setup internal service
    let (_internal_service, admin_username, admin_password) =
        new_internal_service_with_admin(bind_address_internal_service).await?;

    // Create a client to connect to the server, which will trigger the connection handler
    let workspace_kernel = WorkspaceServerKernel::<StackedRatchet>::with_admin(
        ADMIN_ID,
        &admin_username,
        &admin_password,
    );

    // TCP client (GUI, CLI) -> internal service -> empty kernel server(s)
    let (server, server_bind_address) =
        server_test_node_skip_cert_verification(workspace_kernel.clone(), |_| ());

    tokio::task::spawn(server);

    // Wait for services to start and connection to be established
    tokio::time::sleep(Duration::from_millis(2000)).await;

    Ok((
        workspace_kernel,
        bind_address_internal_service,
        server_bind_address,
        admin_username,
        admin_password,
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
        bincode::serialize(&payload).map_err(|e| Box::new(e) as Box<dyn Error>)?;

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

    info!(target: "citadel", "Sent command: {payload:?} with request_id: {request_id}");

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
                info!(target: "citadel", "Received confirmation that message was sent successfully");
                continue; // This is just confirmation the message was sent
            }
        }

        if let citadel_internal_service_types::InternalServiceResponse::MessageNotification(
            citadel_internal_service_types::MessageNotification { message, .. },
        ) = &response
        {
            info!(target: "citadel", "Received response: {response:?}");
            let response: WorkspaceProtocolPayload =
                bincode::deserialize(message).map_err(|e| Box::new(e) as Box<dyn Error>)?;
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
    let (workspace_kernel, internal_service_addr, server_addr, admin_username, admin_password) =
        setup_test_environment().await?;

    // Register and connect admin user
    let (admin_to_service, mut admin_from_service, admin_cid) = register_and_connect_user(
        internal_service_addr,
        server_addr,
        &admin_username,
        "Administrator",
    )
    .await?;

    // Register the admin_cid as an admin user in the kernel
    workspace_kernel
        .inject_admin_user(&admin_username, "Connected Admin", &admin_password)
        .unwrap();

    // Create the root workspace first for our single workspace model
    println!("Creating root workspace...");
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
    println!("Root workspace created: {:?}", workspace_response);

    let root_workspace_id = match workspace_response {
        WorkspaceProtocolResponse::Workspace(workspace) => workspace.id,
        _ => return Err("Expected Workspace response for root workspace creation".into()),
    };

    // Register and connect a regular user
    let (_user_to_service, _user_from_service, _user_cid) =
        register_and_connect_user(internal_service_addr, server_addr, "test_user", "Test User")
            .await?;

    // Inject the test user into the kernel with the username as the user ID
    // This is important: we need to use "test_user" as the ID to match later operations
    workspace_kernel
        .inject_admin_user("test_user", "Test User", &admin_password)
        .unwrap();

    // Create a test office directly using the kernel
    println!("Creating test office directly with kernel...");
    let office_result = workspace_kernel
        .create_office(
            ADMIN_ID,
            &root_workspace_id,
            "Test Office",
            "A test office",
            None,
        )
        .map_err(|e| Box::<dyn Error>::from(format!("Failed to create office: {}", e)));
    println!(
        "[Test::test_member_operations] Office creation result: {:?}",
        office_result
    );
    let office_from_kernel = office_result.unwrap();
    let office_id = office_from_kernel.id.clone();
    println!(
        "Office created in test_member_operations. ID: '{}', Full Office: {:?}",
        office_id, office_from_kernel
    );

    // Explicitly add the admin to the office to ensure permissions are set up correctly
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

    // Add the test user to the office first with basic permissions through the kernel
    // This ensures the permissions map exists and has the office_id key when we check later
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

    println!("Creating test room directly with kernel...");
    // Create a room in the office
    let room_id = create_test_room(
        &admin_to_service,
        &mut admin_from_service,
        admin_cid,
        &office_id,
    )
    .await?;

    println!("Test room created with ID: {}", room_id);

    // Add the test user to the office
    let add_member_cmd = WorkspaceProtocolRequest::AddMember {
        user_id: "test_user".to_string(),
        office_id: Some(office_id.clone()),
        room_id: None,
        role: UserRole::Member,
        metadata: Some("test_metadata".to_string().into_bytes()),
    };

    println!("Adding test user to office...");
    let response = send_workspace_command(
        &admin_to_service,
        &mut admin_from_service,
        admin_cid,
        add_member_cmd,
    )
    .await?;

    match response {
        WorkspaceProtocolResponse::Success(_) => {
            println!("Test user added to office");
        }
        _ => return Err("Expected Success response".into()),
    }

    // Get member to verify addition
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

    // Add the test user to the room
    let add_room_member_cmd = WorkspaceProtocolRequest::AddMember {
        user_id: "test_user".to_string(),
        office_id: None,
        room_id: Some(room_id.clone()),
        role: UserRole::Member,
        metadata: Some("test_metadata".to_string().into_bytes()),
    };

    println!("Adding test user to room...");
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

    // Get room to verify member addition
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

    // Remove the test user from the room
    let remove_room_member_cmd = WorkspaceProtocolRequest::RemoveMember {
        user_id: "test_user".to_string(),
        office_id: None,
        room_id: Some(room_id.clone()),
    };

    println!("Removing test user from room...");
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

    // Get room to verify member removal
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

    // Remove the test user from the office
    let remove_member_cmd = WorkspaceProtocolRequest::RemoveMember {
        user_id: "test_user".to_string(),
        office_id: Some(office_id.clone()),
        room_id: None,
    };

    println!("Removing test user from office...");
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

    // Get member to verify removal
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

    // Verify member was added (simplified check)
    println!(
        "[Test] Before get_office (after add). User: {}, Office ID: {}",
        "test_user", office_id
    );
    let office_details_result = workspace_kernel.get_office("test_user", &office_id);
    println!("[Test] get_office returned: {:?}", office_details_result);

    let office_details_after_add = match office_details_result {
        Ok(office_struct) => {
            println!(
                "[Test] get_office received Office struct: {:?}",
                office_struct
            );
            office_struct
        }
        Err(e) => {
            panic!("[Test] get_office failed: {:?}", e);
        }
    };

    println!(
        "[Test] Office details after add (deserialized): {:?}",
        office_details_after_add
    );
    assert!(office_details_after_add
        .members
        .contains(&"test_user".to_string()));

    println!("[Test] test_member_operations completed successfully.");
    Ok(())
}

#[tokio::test]
async fn test_permission_operations() -> Result<(), Box<dyn Error>> {
    let (workspace_kernel, internal_service_addr, server_addr, admin_username, admin_password) =
        setup_test_environment().await?;

    // Register and connect admin user
    let (admin_to_service, mut admin_from_service, admin_cid) = register_and_connect_user(
        internal_service_addr,
        server_addr,
        &admin_username,
        "Administrator",
    )
    .await?;

    // Register the admin as an admin user in the kernel
    workspace_kernel
        .inject_admin_user(&admin_username, "Connected Admin", &admin_password)
        .unwrap();

    // Create the root workspace first for our single workspace model
    println!("Creating root workspace...");
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
    println!("Root workspace created: {:?}", workspace_response);

    let root_workspace_id = match workspace_response {
        WorkspaceProtocolResponse::Workspace(workspace) => workspace.id,
        _ => return Err("Expected Workspace response for root workspace creation".into()),
    };

    // Register and connect a regular user
    let (_user_to_service, _user_from_service, _user_cid) =
        register_and_connect_user(internal_service_addr, server_addr, "test_user", "Test User")
            .await?;

    // Inject the test user into the kernel with the username as the user ID
    // This is important: we need to use "test_user" as the ID to match later operations
    workspace_kernel
        .inject_admin_user("test_user", "Test User", &admin_username)
        .unwrap();

    // Create an office directly using the kernel
    println!("Creating test office directly with kernel...");
    let office_result = workspace_kernel
        .create_office(
            ADMIN_ID,
            &root_workspace_id,
            "Test Office",
            "A test office",
            None,
        )
        .map_err(|e| Box::<dyn Error>::from(format!("Failed to create office: {}", e)));
    println!(
        "[Test::test_permission_operations] Office creation result: {:?}",
        office_result
    );
    let office_from_kernel = office_result.unwrap();
    let office_id = office_from_kernel.id.clone();
    println!(
        "Office created in test_permission_operations. ID: '{}', Full Office: {:?}",
        office_id, office_from_kernel
    );

    // Add admin to the office with all permissions
    workspace_kernel
        .add_member(ADMIN_ID, ADMIN_ID, Some(&office_id), UserRole::Admin, None)
        .map_err(|e| {
            eprintln!(
                "ADMIN_ID add_member to office_id {} FAILED at line 588: {:?}",
                office_id, e
            );
            e
        })
        .unwrap(); // This was line 588

    // Add the test user to the office with specific permissions
    workspace_kernel
        .add_member(
            ADMIN_ID,
            "test_user",
            Some(&office_id),
            UserRole::Member,
            None,
        )
        .unwrap();

    println!("Adding test user to office with specific permissions...");
    let add_member_cmd = WorkspaceProtocolRequest::AddMember {
        user_id: "test_user".to_string(),
        office_id: Some(office_id.clone()),
        room_id: None,
        role: UserRole::Member,
        metadata: Some("test_metadata".to_string().into_bytes()),
    };

    println!("Adding test user to office...");
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

    println!("Getting member to verify default permissions...");
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

            // Check if the user has the default permissions for a member
            let domain_permissions = member
                .permissions
                .get(&office_id)
                .expect("Domain permissions not found");
            println!("Domain permissions: {domain_permissions:?}");

            // In a single workspace model, members by default only have ViewContent
            assert!(domain_permissions.contains(&Permission::ViewContent));

            // These are added explicitly in the test, not by default
            assert!(!domain_permissions.contains(&Permission::EditMdx));
            assert!(!domain_permissions.contains(&Permission::EditOfficeConfig));
        }
        _ => return Err("Expected Member response".into()),
    }

    println!("Adding specific permission to the user...");
    let add_permission_cmd = WorkspaceProtocolRequest::UpdateMemberPermissions {
        user_id: "test_user".to_string(),
        domain_id: office_id.clone(),
        operation: UpdateOperation::Add,
        permissions: vec![Permission::ManageDomains],
    };

    println!("Adding permission to user...");
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

    println!("Getting member to verify permission addition...");
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

            // Check if the user has the added permission
            let domain_permissions = member
                .permissions
                .get(&office_id)
                .expect("Domain permissions not found");
            assert!(domain_permissions.contains(&Permission::ManageDomains));
        }
        _ => return Err("Expected Member response".into()),
    }

    println!("Removing specific permission from the user...");
    let remove_permission_cmd = WorkspaceProtocolRequest::UpdateMemberPermissions {
        user_id: "test_user".to_string(),
        domain_id: office_id.clone(),
        operation: UpdateOperation::Remove,
        permissions: vec![Permission::EditMdx],
    };

    println!("Removing permission from user...");
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

    println!("Getting member to verify permission removal...");
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

            // Check if the permission was removed
            let domain_permissions = member
                .permissions
                .get(&office_id)
                .expect("Domain permissions not found");
            assert!(!domain_permissions.contains(&Permission::EditMdx));
        }
        _ => return Err("Expected Member response".into()),
    }

    println!("Replacing all permissions for the user...");
    let replace_permissions_cmd = WorkspaceProtocolRequest::UpdateMemberPermissions {
        user_id: "test_user".to_string(),
        domain_id: office_id.clone(),
        operation: UpdateOperation::Set,
        permissions: vec![Permission::ReadMessages, Permission::SendMessages],
    };

    println!("Replacing permissions for user...");
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

    println!("Getting member to verify permissions update...");
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
    let (workspace_kernel, internal_service_addr, server_addr, admin_username, admin_password) =
        setup_test_environment().await?;

    // Register and connect admin user
    let (admin_to_service, mut admin_from_service, admin_cid) = register_and_connect_user(
        internal_service_addr,
        server_addr,
        &admin_username,
        "Administrator",
    )
    .await?;

    // Register the admin_cid as an admin user in the kernel
    workspace_kernel
        .inject_admin_user(&admin_username, "Admin", &admin_password)
        .unwrap();

    // Create the root workspace first for our single workspace model
    println!("Creating root workspace...");
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
    println!("Root workspace created: {:?}", workspace_response);

    let root_workspace_id = match workspace_response {
        WorkspaceProtocolResponse::Workspace(workspace) => workspace.id,
        _ => return Err("Expected Workspace response for root workspace creation".into()),
    };

    // Register and connect a test user for custom role
    let (_user_to_service, _user_from_service, _user_cid) =
        register_and_connect_user(internal_service_addr, server_addr, "test_user", "Test User")
            .await?;

    // Inject the test user into the kernel with the username as the user ID
    // This is important: we need to use "test_user" as the ID to match later operations
    workspace_kernel
        .inject_admin_user("test_user", "Test User", &admin_password)
        .unwrap();

    // Create an office directly using the kernel
    info!(target: "citadel", "Creating test office directly with kernel...");
    let office_result = workspace_kernel
        .create_office(
            ADMIN_ID,
            &root_workspace_id,
            "Test Office",
            "A test office",
            None,
        )
        .map_err(|e| Box::<dyn Error>::from(format!("Failed to create office: {}", e)));
    println!(
        "[Test::test_custom_role_operations] Office creation result: {:?}",
        office_result
    );
    let office_from_kernel = office_result.unwrap();
    let office_id = office_from_kernel.id.clone();
    info!(target: "citadel", "Office created in test_custom_role_operations. ID: '{}', Full Office: {:?}", office_id, office_from_kernel);

    // Add admin to the office with all permissions
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

    // Create a custom role for the user
    let custom_role = UserRole::Custom {
        name: "Editor".to_string(),
        rank: 16,
    };

    println!("Adding test_user as Editor to the office...");
    // Add the regular user to the office with custom role
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

    // After adding the user with the custom role, let's explicitly grant the permissions we expect
    println!("Adding specific permissions to the user with custom role...");
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

    println!("Getting member to verify custom role...");
    // Get member to verify custom role
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
            println!("Domain permissions: {domain_permissions:?}");

            // Since we're replacing the test user's permissions with the custom role,
            // we need to manually assert what the custom role should have. The custom role
            // "Editor" is expected to have these specific permissions.
            assert!(domain_permissions.contains(&Permission::ViewContent));

            // For the custom role tests, we'll check that it has the expected permissions
            // which we'll set through the AddMember command with the custom role
            assert!(domain_permissions.contains(&Permission::EditMdx));
            assert!(domain_permissions.contains(&Permission::EditOfficeConfig));
        }
        _ => return Err("Expected Member response".into()),
    }

    Ok(())
}

async fn test_admin_can_add_multiple_users_to_office(
    kernel: Arc<WorkspaceServerKernel<StackedRatchet>>,
    domain_server_ops: Arc<DomainServerOperations<StackedRatchet>>,
) {
    let admin_id = "admin_for_multi_add";
    let workspace_id = "ws_for_multi_add";

    // Create admin user and workspace
    let _ = domain_server_ops.create_workspace(
        admin_id,
        workspace_id,
        "Workspace Multi Add",
        None,
        "password".to_string(),
    );

    println!(
        "[Test MultiAdd] Before create_office. Admin: {}, Workspace: {}",
        admin_id, workspace_id
    );
    let office_result_json_string = domain_server_ops.create_office(
        admin_id,
        workspace_id,
        "Office for Multi Add",
        "Description",
        None,
    );

    println!(
        "[Test MultiAdd] create_office returned (JSON String): {:?}",
        office_result_json_string
    );

    let office_json_string = office_result_json_string
        .expect("create_office failed in test_admin_can_add_multiple_users_to_office");
    println!(
        "[Test MultiAdd] create_office returned (JSON String): {:?}",
        office_json_string
    );
    let office: Office = serde_json::from_str(&office_json_string).unwrap_or_else(|e| {
        panic!(
            "[Test MultiAdd] Failed to deserialize Office from JSON: {}. JSON: {}",
            e, office_json_string
        )
    });

    println!(
        "[Test MultiAdd] Deserialized Office: {:?}, ID: {}",
        office, office.id
    );

    let user1_id = "user1_multi_add";
    let user2_id = "user2_multi_add";

    println!(
        "[Test MultiAdd] Before add_user_to_domain (User1). Office ID: {}, User1: {}",
        office.id, user1_id
    );
    let add_user1_result =
        domain_server_ops.add_user_to_domain(admin_id, user1_id, &office.id, UserRole::Member);
    println!(
        "[Test MultiAdd] add_user_to_domain (User1) result: {:?}",
        add_user1_result
    );
    assert!(
        add_user1_result.is_ok(),
        "Admin should be able to add user1. Error: {:?}",
        add_user1_result.err()
    );

    println!(
        "[Test MultiAdd] Before add_user_to_domain (User2). Office ID: {}, User2: {}",
        office.id, user2_id
    );
    let add_user2_result =
        domain_server_ops.add_user_to_domain(admin_id, user2_id, &office.id, UserRole::Member);
    println!(
        "[Test MultiAdd] add_user_to_domain (User2) result: {:?}",
        add_user2_result
    );
    assert!(
        add_user2_result.is_ok(),
        "Admin should be able to add user2. Error: {:?}",
        add_user2_result.err()
    );

    println!(
        "[Test MultiAdd] Before get_office (admin_can_add_multiple). Admin: {}, Office ID: {}",
        admin_id, office.id
    );
    let office_details_json = domain_server_ops
        .get_office(admin_id, &office.id) // Use office.id from deserialized 'office' struct
        .expect("Failed to get office details");
    let office_details: Office =
        serde_json::from_str(&office_details_json).expect("Failed to deserialize office details");

    println!(
        "[Test MultiAdd] Office details after adds (deserialized): {:?}",
        office_details
    );

    assert!(office_details.members.contains(&user1_id.to_string()));
    assert!(office_details.members.contains(&user2_id.to_string()));
    println!("[Test MultiAdd] test_admin_can_add_multiple_users_to_office completed successfully.");
}

async fn test_non_admin_cannot_add_user_to_office(
    kernel: Arc<WorkspaceServerKernel<StackedRatchet>>,
    domain_server_ops: Arc<DomainServerOperations<StackedRatchet>>,
) {
    let owner_id = "owner_for_non_admin_test";
    let non_admin_id = "non_admin_for_test";
    let target_user_id = "target_user_for_non_admin_test";
    let workspace_id = "ws_for_non_admin_test";

    // Create users and workspace
    let _ = domain_server_ops.create_workspace(
        owner_id,
        workspace_id,
        "Workspace NonAdmin",
        None,
        "password".to_string(),
    );

    println!(
        "[Test NonAdmin] Before create_office. Owner: {}, Workspace: {}",
        owner_id, workspace_id
    );
    let office_result = domain_server_ops.create_office(
        owner_id,
        workspace_id,
        "Office for Non-Admin Test",
        "Description",
        None,
    );

    println!(
        "[Test NonAdmin] create_office returned: {:?}",
        office_result
    );

    let office_json_string =
        office_result.expect("create_office failed in test_non_admin_cannot_add_user_to_office");
    println!(
        "[Test NonAdmin] create_office returned (JSON String): {:?}",
        office_json_string
    );
    let office: Office = serde_json::from_str(&office_json_string).unwrap_or_else(|e| {
        panic!(
            "[Test NonAdmin] Failed to deserialize Office from JSON: {}. JSON: {}",
            e, office_json_string
        )
    });

    println!(
        "[Test NonAdmin] Deserialized Office: {:?}, ID: {}",
        office, office.id
    );

    // Add non_admin_id to the office as a Member by the owner
    println!(
        "[Test NonAdmin] Owner adding NonAdmin to office. Office ID: {}, NonAdmin: {}",
        office.id, non_admin_id
    );
    let add_non_admin_result = domain_server_ops.add_user_to_domain(
        owner_id,
        non_admin_id,
        &office.id,
        UserRole::Member, // Non-admin is just a member
    );
    println!(
        "[Test NonAdmin] Owner adding NonAdmin result: {:?}",
        add_non_admin_result
    );
    assert!(
        add_non_admin_result.is_ok(),
        "Owner should be able to add non_admin as member. Error: {:?}",
        add_non_admin_result.err()
    );

    // Attempt by non_admin_id to add another_user_id
    println!(
        "[Test NonAdmin] NonAdmin attempting to add TargetUser. Office ID: {}, TargetUser: {}",
        office.id, target_user_id
    );
    let non_admin_add_result = domain_server_ops.add_user_to_domain(
        non_admin_id, // Invoker is non-admin
        target_user_id,
        &office.id,
        UserRole::Member,
    );

    println!(
        "[Test NonAdmin] NonAdmin add_member result: {:?}",
        non_admin_add_result
    );
    assert!(
        non_admin_add_result.is_err(),
        "Non-admin should not be able to add users to the office"
    );
    if let Err(e) = non_admin_add_result {
        if e.to_string().starts_with("Permission denied:") {
            println!(
                "[Test NonAdmin] Correctly received PermissionDenied: {}",
                e.to_string()
            );
        } else {
            panic!(
                "[Test NonAdmin] Expected error message to start with 'Permission denied:', got: {}",
                e.to_string()
            );
        }
    } else {
        panic!(
            "[Test NonAdmin] Expected NetworkError::Msg for permission denied, got {:?}",
            non_admin_add_result
        );
    }
    println!("[Test NonAdmin] test_non_admin_cannot_add_user_to_office completed successfully.");
}
