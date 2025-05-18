use citadel_internal_service::kernel::CitadelWorkspaceService;
use citadel_internal_service_test_common::{
    self as common, get_free_port, server_test_node_skip_cert_verification,
};
use citadel_sdk::prelude::{
    BackendType, NetworkError, NodeBuilder, NodeType, PreSharedKey, StackedRatchet,
};
use citadel_workspace_server_kernel::kernel::WorkspaceServerKernel;
use citadel_workspace_server_kernel::WORKSPACE_MASTER_PASSWORD_KEY;
use citadel_workspace_types::{
    structs::{MetadataValue, User, UserRole},
    WorkspaceProtocolPayload, WorkspaceProtocolRequest, WorkspaceProtocolResponse,
};
use std::error::Error;
use std::net::SocketAddr;
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
    println!("Setting up internal service");
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
    println!("Starting internal service");
    let service_handle = tokio::task::spawn(internal_service);

    // Wait for the remote to be initialized
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;

    // Generate admin credentials
    println!("Generating admin credentials");
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
    println!("Setting up internal service");
    let bind_address_internal_service: SocketAddr =
        format!("127.0.0.1:{}", get_free_port()).parse().unwrap();

    // Setup internal service
    println!("Setting up internal service");
    let (_internal_service, admin_username, admin_password) =
        new_internal_service_with_admin(bind_address_internal_service).await?;

    // Create a client to connect to the server, which will trigger the connection handler
    println!("Creating workspace kernel");
    let workspace_kernel =
        WorkspaceServerKernel::<StackedRatchet>::with_admin(ADMIN_ID, &admin_username, &admin_password);

    // TCP client (GUI, CLI) -> internal service -> empty kernel server(s)
    println!("Setting up server");
    let (server, server_bind_address) =
        server_test_node_skip_cert_verification(workspace_kernel.clone(), |_| ());

    println!("Starting server");
    tokio::task::spawn(server);

    // Wait for services to start and connection to be established
    println!("Waiting for services to start");
    tokio::time::sleep(Duration::from_millis(2000)).await;

    // Inject the workspace master password into the admin user's metadata
    // This simulates what `run_server` does during actual startup
    println!("Injecting workspace password into admin metadata...");
    workspace_kernel.inject_admin_user(&admin_username, "Admin", &admin_password).unwrap();

    println!("Done setting up test environment");
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
    password: &str,
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
        full_name: "Test Name".to_string(),
        username,
        password,
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
    let serialized_command = serde_json::to_vec(&payload)?;

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

    println!(
        "Sent command: {:?} with request_id: {}",
        payload, request_id
    );

    // Wait for response
    while let Some(response) = from_service.recv().await {
        println!("Received response: {:?}", response);

        if let citadel_internal_service_types::InternalServiceResponse::MessageSendSuccess(
            citadel_internal_service_types::MessageSendSuccess {
                request_id: resp_id,
                ..
            },
        ) = &response
        {
            if resp_id.as_ref() == Some(&request_id) {
                println!("Received confirmation that message was sent successfully");
                continue; // This is just confirmation the message was sent
            }
        }

        if let citadel_internal_service_types::InternalServiceResponse::MessageNotification(
            citadel_internal_service_types::MessageNotification { message, .. },
        ) = response
        {
            // Deserialize the response
            let workspace_response: WorkspaceProtocolPayload = serde_json::from_slice(&message)?;
            let WorkspaceProtocolPayload::Response(response) = workspace_response else {
                panic!("Expected WorkspaceProtocolPayload::Response")
            };
            return Ok(response);
        }

        println!("Received unexpected response: {:?}", response);
    }

    Err("No response received".into())
}

#[tokio::test]
async fn test_office_operations() {
    println!("Setting up test environment...");
    let (kernel, internal_service_addr, server_addr, admin_username, admin_password) =
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

    // Register the admin_cid as an admin user in the kernel
    kernel
        .inject_admin_user(&admin_cid.to_string(), "Connected Admin User", &admin_password)
        .unwrap();

    // Create the root workspace first for our single workspace model
    println!("Creating root workspace...");
    let create_workspace_cmd = WorkspaceProtocolRequest::CreateWorkspace {
        name: "Root Workspace".to_string(),
        description: "Root workspace for the system".to_string(),
        workspace_master_password: admin_password.clone(), // Provide correct password
        metadata: None,
    };

    let workspace_response = send_workspace_command(
        &to_service,
        &mut from_service,
        admin_cid,
        create_workspace_cmd,
    )
    .await
    .expect("Failed to create root workspace");

    println!("Root workspace created: {:?}", workspace_response);

    // --- Test: Attempt to create workspace with WRONG password --- 
    println!("Attempting to create workspace with wrong password...");
    let create_workspace_wrong_pw_cmd = WorkspaceProtocolRequest::CreateWorkspace {
        name: "Wrong PW Workspace".to_string(),
        description: "Should fail".to_string(),
        workspace_master_password: "wrong-password".to_string(), // Provide wrong password
        metadata: None,
    };
    
    let error_response = send_workspace_command(
        &to_service,
        &mut from_service,
        admin_cid,
        create_workspace_wrong_pw_cmd,
    )
    .await
    .expect("Sending wrong password command should succeed, but result in error response");

    match error_response {
        WorkspaceProtocolResponse::Error(msg) => {
            assert!(msg.contains("Incorrect workspace master password"), "Expected password error, got: {}", msg);
            println!("Received expected error for wrong password: {}", msg);
        },
        _ => panic!("Expected Error response for wrong password, got: {:?}", error_response),
    }
    // --- End Test --- 

    // Create an office using the command processor instead of directly
    println!("Creating test office...");
    let create_office_cmd = WorkspaceProtocolRequest::CreateOffice {
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
                offices.len() >= 1,
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

#[tokio::test]
async fn test_room_operations() {
    println!("Setting up test environment...");
    let (kernel, internal_service_addr, server_addr, admin_username, admin_password) =
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

    // Inject the workspace master password into the admin user's metadata
    // This simulates what `run_server` does during actual startup
    println!("Injecting workspace password into admin metadata...");
    kernel.inject_admin_user(&admin_username, "Admin", &admin_password).unwrap();

    // Create the root workspace first for our single workspace model
    println!("Creating root workspace...");
    let create_workspace_cmd = WorkspaceProtocolRequest::CreateWorkspace {
        name: "Root Workspace".to_string(),
        description: "Root workspace for the system".to_string(),
        workspace_master_password: admin_password.clone(), // Provide correct password
        metadata: None,
    };

    let workspace_response = send_workspace_command(
        &to_service,
        &mut from_service,
        admin_cid,
        create_workspace_cmd,
    )
    .await
    .unwrap();

    println!("Root workspace created: {:?}", workspace_response);

    // Create an office using the command processor instead of directly
    println!("Creating test office...");
    let create_office_cmd = WorkspaceProtocolRequest::CreateOffice {
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

    println!("Creating test room...");
    let create_room_cmd = WorkspaceProtocolRequest::CreateRoom {
        office_id: office_id.clone(),
        name: "Test Room".to_string(),
        description: "A test room".to_string(),
        mdx_content: Some("# Test Room\nThis is a test room".to_string()),
        metadata: None,
    };

    let response =
        send_workspace_command(&to_service, &mut from_service, admin_cid, create_room_cmd)
            .await
            .unwrap();
    let room_id = match response {
        WorkspaceProtocolResponse::Room(room) => {
            assert_eq!(room.name, "Test Room");
            assert_eq!(room.description, "A test room");
            assert_eq!(room.mdx_content, "# Test Room\nThis is a test room");
            room.id.clone()
        }
        _ => panic!("Expected Room response"),
    };

    println!("Test room created.");

    println!("Getting test room...");
    let get_room_cmd = WorkspaceProtocolRequest::GetRoom {
        room_id: room_id.clone(),
    };

    let response = send_workspace_command(&to_service, &mut from_service, admin_cid, get_room_cmd)
        .await
        .unwrap();

    match response {
        WorkspaceProtocolResponse::Room(room) => {
            assert_eq!(room.name, "Test Room");
            assert_eq!(room.description, "A test room");
            assert_eq!(room.mdx_content, "# Test Room\nThis is a test room");
        }
        _ => panic!("Expected Room response"),
    }

    println!("Test room retrieved.");

    println!("Updating test room...");
    let update_room_cmd = WorkspaceProtocolRequest::UpdateRoom {
        room_id: room_id.clone(),
        name: Some("Updated Room".to_string()),
        description: None,
        mdx_content: Some("# Updated Room\nThis room content has been updated".to_string()),
        metadata: None,
    };

    let response =
        send_workspace_command(&to_service, &mut from_service, admin_cid, update_room_cmd)
            .await
            .unwrap();

    match response {
        WorkspaceProtocolResponse::Room(room) => {
            assert_eq!(room.name, "Updated Room");
            assert_eq!(room.description, "A test room");
            assert_eq!(
                room.mdx_content,
                "# Updated Room\nThis room content has been updated"
            );
        }
        _ => panic!("Expected Room response"),
    }

    println!("Test room updated.");

    println!("Listing rooms...");
    let list_rooms_cmd = WorkspaceProtocolRequest::ListRooms {
        office_id: office_id.clone(),
    };

    let response =
        send_workspace_command(&to_service, &mut from_service, admin_cid, list_rooms_cmd)
            .await
            .unwrap();

    match response {
        WorkspaceProtocolResponse::Rooms(rooms) => {
            assert_eq!(rooms.len(), 1);
            assert_eq!(rooms[0].name, "Updated Room");
        }
        _ => panic!("Expected Rooms response"),
    }

    println!("Rooms listed.");

    println!("Deleting test room...");
    let delete_room_cmd = WorkspaceProtocolRequest::DeleteRoom { room_id };

    let response =
        send_workspace_command(&to_service, &mut from_service, admin_cid, delete_room_cmd)
            .await
            .unwrap();

    match response {
        WorkspaceProtocolResponse::Success(_) => {}
        _ => panic!("Expected Success response"),
    }

    println!("Test room deleted.");

    println!("Verifying room was deleted...");
    let list_rooms_cmd = WorkspaceProtocolRequest::ListRooms { office_id };

    let response =
        send_workspace_command(&to_service, &mut from_service, admin_cid, list_rooms_cmd)
            .await
            .unwrap();

    match response {
        WorkspaceProtocolResponse::Rooms(rooms) => {
            assert_eq!(rooms.len(), 0);
        }
        _ => panic!("Expected Rooms response"),
    }
}
