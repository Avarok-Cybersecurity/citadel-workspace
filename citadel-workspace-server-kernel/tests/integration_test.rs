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
use citadel_workspace_server::structs::UserRole;
use futures::{sink, SinkExt, StreamExt};
use std::default;
use std::error::Error;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::mpsc::{unbounded_channel, UnboundedReceiver};
use tokio::task::JoinHandle;
use uuid::Uuid;

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

    let (mut sink, mut stream) = InternalServiceConnector::connect(bind_address_internal_service)
        .await?
        .split();

    tokio::time::sleep(std::time::Duration::from_secs(2)).await;

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

    // println!("Admin credentials: username = {}, password = {}", admin_username, admin_password);

    // let register_command = InternalServiceRequest::Register {
    //         request_id: Uuid::new_v4(),
    //         server_addr: bind_address_internal_service,
    //         full_name: "Test Name".into(),
    //         username: admin_username.clone(),
    //         proposed_password: SecBuffer::from(admin_password.clone().as_bytes()),
    //         session_security_settings: Default::default(),
    //         connect_after_register: false,
    //         server_password: None,
    //     };
    //     sink.send(register_command).await.unwrap();
    //     println!("Sent register command, waiting for response");
    //     let response_packet = stream.next().await.unwrap();
    //     println!("Received response: {:?}", response_packet);
    //     if let InternalServiceResponse::RegisterSuccess(
    //         citadel_internal_service_types::RegisterSuccess { request_id: _, .. },
    //     ) = response_packet
    //     {
    //         println!("Successfully Registered to Server using Pre-Shared Key");
    //     } else {
    //         println!("Failed to register to Server");
    //         panic!("Didn't Receive Expected RegisterSuccess");
    //     }

    Ok((service_handle, admin_username, admin_password))
}

async fn setup_test_environment() -> Result<(SocketAddr, SocketAddr, String, String), Box<dyn Error>>
{
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
        WorkspaceServerKernel::<StackedRatchet>::with_admin(&admin_username, &admin_username);

    // TCP client (GUI, CLI) -> internal service -> empty kernel server(s)
    println!("Setting up server");
    let (server, server_bind_address) =
        server_test_node_skip_cert_verification(workspace_kernel, |_| ());

    println!("Starting server");
    tokio::task::spawn(server);

    // Wait for services to start and connection to be established
    println!("Waiting for services to start");
    tokio::time::sleep(Duration::from_millis(2000)).await;

    println!("Done setting up test environment");
    Ok((
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

#[tokio::test]
async fn test_office_operations() {
    println!("Setting up test environment...");
    let (internal_service_addr, server_addr, admin_username, admin_password) =
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

    // let admin_upgrade_cmd = WorkspaceCommand::UpdateMemberRole {
    //     user_id: cid.to_string(),
    //     role: UserRole::Admin,
    // };

    // println!("Upgrading user to admin...");
    // let admin_upgrade_response =
    //     send_workspace_command(&to_service, &mut from_service, cid, admin_upgrade_cmd).await?;
    // println!("User upgraded to admin");

    // println!("Admin upgrade response: {admin_upgrade_response:?}");

    // let list_offices_cmd = WorkspaceCommand::ListOffices;

    // println!("Listing offices...");
    // let list_offices_response =
    //     send_workspace_command(&to_service, &mut from_service, cid, list_offices_cmd).await.unwrap();
    // println!("Offices listed: {list_offices_response:?}");
    // let WorkspaceResponse::Offices(office) = list_offices_response else {
    //     panic!("Expected Offices response");
    // };
    // let office = office.first().unwrap();

    // let list_members_cmd = WorkspaceCommand::ListMembers { office_id: Some(office.id.clone()), room_id: None };

    // println!("Listing members...");
    // let list_members_response =
    //     send_workspace_command(&to_service, &mut from_service, cid, list_members_cmd).await.unwrap();
    // println!("Members listed: {list_members_response:?}");

    // let get_member_cmd = WorkspaceCommand::GetMember {
    //     user_id: cid.to_string(),
    // };

    // println!("Getting user info...");
    // let get_member_response =
    //     send_workspace_command(&to_service, &mut from_service, cid, get_member_cmd).await.unwrap();
    // println!("User info retrieved: {get_member_response:?}");

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
            assert_eq!(offices.len(), 1);
            assert_eq!(offices[0].name, "Updated Office");
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
            assert_eq!(offices.len(), 0);
        }
        _ => panic!("Expected Offices response"),
    }

    println!("Test complete.");
}

#[tokio::test]
async fn test_room_operations() {
    let (internal_service_addr, server_addr, admin_username, admin_password) =
        setup_test_environment().await.unwrap();

    // Register and connect a user
    let (to_service, mut from_service, cid) = register_and_connect_user(
        internal_service_addr,
        server_addr,
        &admin_username,
        &admin_password,
    )
    .await
    .unwrap();

    // Create an office first
    let create_office_cmd = WorkspaceCommand::CreateOffice {
        name: "Test Office".to_string(),
        description: "A test office".to_string(),
    };

    let response = send_workspace_command(&to_service, &mut from_service, cid, create_office_cmd)
        .await
        .unwrap();

    let office_id = match response {
        WorkspaceResponse::Office(office) => office.id.clone(),
        _ => panic!("Expected Office response"),
    };

    // Test creating a room
    let create_room_cmd = WorkspaceCommand::CreateRoom {
        office_id: office_id.clone(),
        name: "Test Room".to_string(),
        description: "A test room".to_string(),
    };

    let response = send_workspace_command(&to_service, &mut from_service, cid, create_room_cmd)
        .await
        .unwrap();

    let room_id = match response {
        WorkspaceResponse::Room(room) => {
            assert_eq!(room.name, "Test Room");
            assert_eq!(room.description, "A test room");
            room.id.clone()
        }
        _ => panic!("Expected Room response"),
    };

    // Test getting the room
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

    // Test updating the room
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

    // Test listing rooms
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

    // Test deleting the room
    let delete_room_cmd = WorkspaceCommand::DeleteRoom { room_id };

    let response = send_workspace_command(&to_service, &mut from_service, cid, delete_room_cmd)
        .await
        .unwrap();

    match response {
        WorkspaceResponse::Success => {}
        _ => panic!("Expected Success response"),
    }

    // Verify the room was deleted
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
