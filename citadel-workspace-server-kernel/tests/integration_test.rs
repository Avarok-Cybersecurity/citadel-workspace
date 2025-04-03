use citadel_internal_service::kernel::CitadelWorkspaceService;
use citadel_internal_service_connector::connector::InternalServiceConnector;
use citadel_internal_service_test_common::get_free_port;
use citadel_internal_service_test_common::{
    self as common, server_info_reactive_skip_cert_verification,
    server_test_node_skip_cert_verification,
};
use citadel_internal_service_types::{InternalServiceRequest, InternalServiceResponse};
use citadel_logging::info;
use citadel_sdk::prelude::*;
use citadel_workspace_server::commands::{WorkspaceCommand, WorkspaceResponse};
use citadel_workspace_server::kernel::WorkspaceServerKernel;
use citadel_workspace_server::structs::{Domain, Room, UserRole};
use futures::{sink, SinkExt, StreamExt};
use std::default;
use std::error::Error;
use std::net::SocketAddr;
use std::ops::Deref;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::mpsc::{unbounded_channel, UnboundedReceiver};
use tokio::task::JoinHandle;
use uuid::Uuid;

const ADMIN_ID: &str = "888888888888";

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
    let admin_username = format!(
        "admin_{}",
        Uuid::new_v4()
            .to_string()
            .split('-')
            .next()
            .unwrap_or("user")
    );
    let admin_password = Uuid::new_v4().to_string();

    Ok((service_handle, admin_username, admin_password))
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
        WorkspaceServerKernel::<StackedRatchet>::with_admin(ADMIN_ID, &admin_username);

    // TCP client (GUI, CLI) -> internal service -> empty kernel server(s)
    println!("Setting up server");
    let (server, server_bind_address) =
        server_test_node_skip_cert_verification(workspace_kernel.clone(), |_| ());

    println!("Starting server");
    tokio::task::spawn(server);

    // Wait for services to start and connection to be established
    println!("Waiting for services to start");
    tokio::time::sleep(Duration::from_millis(2000)).await;

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

    println!(
        "Sent command: {:?} with request_id: {}",
        command, request_id
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
            let workspace_response: WorkspaceResponse = serde_json::from_slice(&message)?;
            return Ok(workspace_response);
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

    println!("Registering and connecting test user...");
    let (to_service, mut from_service, cid) = register_and_connect_user(
        internal_service_addr,
        server_addr,
        &admin_username,
        &admin_password,
    )
    .await
    .unwrap();
    println!("Test user registered and connected with CID: {cid}.");

    let office = kernel
        .create_office(ADMIN_ID, "TEST OFFICE", "OFFICE DESCRIPTION")
        .unwrap();
    let office_id = office.id;

    kernel
        .add_member(
            ADMIN_ID,
            cid.to_string().as_str(),
            Some(&office_id),
            None,
            UserRole::Admin,
        )
        .unwrap();

    println!("Creating test office...");
    let create_office_cmd = WorkspaceCommand::CreateOffice {
        name: "Test Office".to_string(),
        description: "A test office".to_string(),
    };

    let response = send_workspace_command(&to_service, &mut from_service, cid, create_office_cmd)
        .await
        .unwrap();

    println!("Test office created.");

    let office_id = match response {
        WorkspaceResponse::Office(office) => {
            assert_eq!(office.name, "Test Office");
            assert_eq!(office.description, "A test office");
            office.id.clone()
        }
        _ => panic!("Expected Office response"),
    };

    println!("Getting test office...");
    let get_office_cmd = WorkspaceCommand::GetOffice {
        office_id: office_id.clone(),
    };

    let response = send_workspace_command(&to_service, &mut from_service, cid, get_office_cmd)
        .await
        .unwrap();

    match response {
        WorkspaceResponse::Office(office) => {
            assert_eq!(office.name, "Test Office");
            assert_eq!(office.description, "A test office");
        }
        _ => panic!("Expected Office response"),
    }

    println!("Test office retrieved.");

    println!("Updating test office...");
    let update_office_cmd = WorkspaceCommand::UpdateOffice {
        office_id: office_id.clone(),
        name: Some("Updated Office".to_string()),
        description: None,
    };

    let response = send_workspace_command(&to_service, &mut from_service, cid, update_office_cmd)
        .await
        .unwrap();

    match response {
        WorkspaceResponse::Office(office) => {
            assert_eq!(office.name, "Updated Office");
            assert_eq!(office.description, "A test office");
        }
        _ => panic!("Expected Office response"),
    }

    println!("Test office updated.");

    println!("Listing offices...");
    let list_offices_cmd = WorkspaceCommand::ListOffices;

    let response = send_workspace_command(&to_service, &mut from_service, cid, list_offices_cmd)
        .await
        .unwrap();

    match response {
        WorkspaceResponse::Offices(offices) => {
            assert_eq!(offices.len(), 2);
            assert_eq!(offices[1].name, "Updated Office");
        }
        _ => panic!("Expected Offices response"),
    }

    println!("Offices listed.");

    println!("Deleting test office...");
    let delete_office_cmd = WorkspaceCommand::DeleteOffice { office_id };

    let response = send_workspace_command(&to_service, &mut from_service, cid, delete_office_cmd)
        .await
        .unwrap();

    match response {
        WorkspaceResponse::Success => {}
        _ => panic!("Expected Success response"),
    }

    println!("Test office deleted.");

    println!("Verifying office was deleted...");
    let list_offices_cmd = WorkspaceCommand::ListOffices;

    let response = send_workspace_command(&to_service, &mut from_service, cid, list_offices_cmd)
        .await
        .unwrap();

    match response {
        WorkspaceResponse::Offices(offices) => {
            assert_eq!(offices.len(), 1);
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

    println!("Registering and connecting test user...");
    let (to_service, mut from_service, cid) = register_and_connect_user(
        internal_service_addr,
        server_addr,
        &admin_username,
        &admin_password,
    )
    .await
    .unwrap();
    println!("Test user registered and connected with CID: {cid}.");

    let office = kernel
        .create_office(ADMIN_ID, "TEST OFFICE", "OFFICE DESCRIPTION")
        .unwrap();
    let office_id = office.id;

    kernel
        .add_member(
            ADMIN_ID,
            cid.to_string().as_str(),
            Some(&office_id),
            None,
            UserRole::Admin,
        )
        .unwrap();

    // // For testing purposes, directly create the room in the kernel to avoid potential deadlocks
    // println!("Creating room directly in kernel for testing...");
    // let room_id = uuid::Uuid::new_v4().to_string();
    // let room = Room {
    //     id: room_id.clone(),
    //     name: "Test Room".to_string(),
    //     description: "A test room".to_string(),
    //     owner_id: cid.to_string(),
    //     office_id: office_id.clone(),
    //     members: vec![],
    //     mdx_content: String::new(),
    // };

    // // Store the room directly
    // kernel.with_write_transaction(|tx| {
    //     let domain = Domain::Room { room: room.clone() };
    //     tx.insert_domain(room_id.clone(), domain)?;
    //     println!("Room created directly: {}", room_id);
    //     Ok(())
    // }).unwrap();

    // println!("Test room created with ID: {}", room_id);

    println!("Creating test room...");
    let create_room_cmd = WorkspaceCommand::CreateRoom {
        office_id: office_id.clone(),
        name: "Test Room".to_string(),
        description: "A test room".to_string(),
    };

    let response = send_workspace_command(&to_service, &mut from_service, cid, create_room_cmd)
        .await
        .unwrap();

    println!("Test room creation response: {response:?}");

    let room_id = match response {
        WorkspaceResponse::Room(room) => {
            assert_eq!(room.name, "Test Room");
            assert_eq!(room.description, "A test room");
            room.id.clone()
        }
        _ => panic!("Expected Room response"),
    };

    println!("Test room created.");

    println!("Getting test room...");
    let get_room_cmd = WorkspaceCommand::GetRoom {
        room_id: room_id.clone(),
    };

    let response = send_workspace_command(&to_service, &mut from_service, cid, get_room_cmd)
        .await
        .unwrap();

    match response {
        WorkspaceResponse::Room(room) => {
            assert_eq!(room.name, "Test Room");
            assert_eq!(room.description, "A test room");
        }
        _ => panic!("Expected Room response"),
    }

    println!("Test room retrieved.");

    println!("Updating test room...");
    let update_room_cmd = WorkspaceCommand::UpdateRoom {
        room_id: room_id.clone(),
        name: Some("Updated Room".to_string()),
        description: None,
    };

    let response = send_workspace_command(&to_service, &mut from_service, cid, update_room_cmd)
        .await
        .unwrap();

    match response {
        WorkspaceResponse::Room(room) => {
            assert_eq!(room.name, "Updated Room");
            assert_eq!(room.description, "A test room");
        }
        _ => panic!("Expected Room response"),
    }

    println!("Test room updated.");

    println!("Listing rooms...");
    let list_rooms_cmd = WorkspaceCommand::ListRooms {
        office_id: office_id.clone(),
    };

    let response = send_workspace_command(&to_service, &mut from_service, cid, list_rooms_cmd)
        .await
        .unwrap();

    match response {
        WorkspaceResponse::Rooms(rooms) => {
            assert_eq!(rooms.len(), 1);
            assert_eq!(rooms[0].name, "Updated Room");
        }
        _ => panic!("Expected Rooms response"),
    }

    println!("Rooms listed.");

    println!("Deleting test room...");
    let delete_room_cmd = WorkspaceCommand::DeleteRoom { room_id };

    let response = send_workspace_command(&to_service, &mut from_service, cid, delete_room_cmd)
        .await
        .unwrap();

    match response {
        WorkspaceResponse::Success => {}
        _ => panic!("Expected Success response"),
    }

    println!("Test room deleted.");

    println!("Verifying room was deleted...");
    let list_rooms_cmd = WorkspaceCommand::ListRooms { office_id };

    let response = send_workspace_command(&to_service, &mut from_service, cid, list_rooms_cmd)
        .await
        .unwrap();

    match response {
        WorkspaceResponse::Rooms(rooms) => {
            assert_eq!(rooms.len(), 0);
        }
        _ => panic!("Expected Rooms response"),
    }
}
