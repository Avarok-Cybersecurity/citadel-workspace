use citadel_internal_service::kernel::CitadelWorkspaceService;
use citadel_internal_service_test_common::{
    self as common, get_free_port, server_test_node_skip_cert_verification,
};
use citadel_sdk::prelude::{
    BackendType, NetworkError, NodeBuilder, NodeType, PreSharedKey, StackedRatchet,
};
use citadel_workspace_server_kernel::{kernel::WorkspaceServerKernel, WORKSPACE_ROOT_ID};
use citadel_workspace_types::{
    WorkspaceProtocolPayload, WorkspaceProtocolRequest, WorkspaceProtocolResponse,
};
use rocksdb::DB;
use std::error::Error;
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;
use tempfile::TempDir;
use tokio::sync::mpsc::UnboundedReceiver;
use tokio::task::JoinHandle;
use uuid::Uuid;

pub const ADMIN_ID: &str = "admin";

/// Creates a new internal service with admin user
pub async fn new_internal_service_with_admin(
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

/// Sets up the complete test environment with database, internal service, and workspace kernel
pub async fn setup_test_environment() -> Result<
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
    let db_temp_dir = TempDir::new().expect("Failed to create temp dir for DB");
    let db_path = db_temp_dir.path().join("integration_test_db");
    let db =
        tokio::task::spawn_blocking(move || DB::open_default(&db_path).expect("Failed to open DB"))
            .await
            .expect("DB task panicked");
    let workspace_kernel = WorkspaceServerKernel::<StackedRatchet>::with_admin(
        ADMIN_ID,
        &admin_username,
        &admin_password,
        Arc::new(db),
    );

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
    workspace_kernel
        .inject_admin_user(&admin_username, "Admin", &admin_password)
        .unwrap();

    println!("Done setting up test environment");
    Ok((
        workspace_kernel,
        bind_address_internal_service,
        server_bind_address,
        admin_username,
        admin_password,
        db_temp_dir,
    ))
}

/// Registers and connects a user to the test environment
pub async fn register_and_connect_user(
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

/// Sends a workspace command and waits for the response with detailed logging
pub async fn send_workspace_command(
    to_service: &tokio::sync::mpsc::UnboundedSender<
        citadel_internal_service_types::InternalServiceRequest,
    >,
    from_service: &mut UnboundedReceiver<citadel_internal_service_types::InternalServiceResponse>,
    cid: u64,
    command: WorkspaceProtocolRequest,
) -> Result<WorkspaceProtocolResponse, Box<dyn Error>> {
    println!("Sending command: {:?} for CID: {}", command, cid);
    let request_id = Uuid::new_v4();
    let payload = WorkspaceProtocolPayload::Request(command.clone());
    let message_bytes = serde_json::to_vec(&payload).map_err(|e| Box::new(e) as Box<dyn Error>)?;

    let internal_request = citadel_internal_service_types::InternalServiceRequest::Message {
        request_id,
        cid,
        message: message_bytes,
        peer_cid: None,
        security_level: citadel_internal_service_types::SecurityLevel::Standard,
    };

    to_service.send(internal_request)?;

    // Wait for the response from the service
    // The first response might be a MessageSendSuccess, which we should ignore and wait for the actual MessageNotification.
    println!(
        "Waiting for first response from service for request_id: {}",
        request_id
    );

    while let Some(response) = from_service.recv().await {
        match response {
            citadel_internal_service_types::InternalServiceResponse::MessageSendSuccess(
                msg_success,
            ) => {
                if msg_success.request_id.as_ref() == Some(&request_id) {
                    println!("Received MessageSendSuccess for request_id: {}", request_id);
                    // Continue waiting for the actual response
                    continue;
                }
            }
            citadel_internal_service_types::InternalServiceResponse::MessageNotification(
                msg_notification,
            ) => {
                println!("Received MessageNotification: {:?}", msg_notification);
                let response: WorkspaceProtocolPayload =
                    serde_json::from_slice(&msg_notification.message)
                        .map_err(|e| Box::new(e) as Box<dyn Error>)?;

                match response {
                    WorkspaceProtocolPayload::Response(workspace_response) => {
                        println!("Received workspace response: {:?}", workspace_response);
                        return Ok(workspace_response);
                    }
                    _ => {
                        return Err("Expected WorkspaceProtocolPayload::Response".into());
                    }
                }
            }
            _ => {
                println!("Received unexpected response: {:?}", response);
                continue;
            }
        }
    }

    Err("No response received".into())
}
