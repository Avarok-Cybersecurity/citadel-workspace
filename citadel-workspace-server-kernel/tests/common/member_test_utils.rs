use citadel_internal_service::kernel::CitadelWorkspaceService;
use citadel_internal_service_test_common::get_free_port;
use citadel_internal_service_test_common::{
    self as common, server_test_node_skip_cert_verification,
};
use citadel_logging::info;
use citadel_sdk::prelude::*;
use citadel_workspace_server_kernel::handlers::domain::async_ops::AsyncDomainOperations;
use citadel_workspace_server_kernel::handlers::domain::server_ops::async_domain_server_ops::AsyncDomainServerOperations;
use citadel_workspace_server_kernel::kernel::async_kernel::AsyncWorkspaceServerKernel;
use citadel_workspace_server_kernel::WORKSPACE_ROOT_ID;
use citadel_workspace_types::structs::{Office, Permission, User, UserRole};
use citadel_workspace_types::{
    UpdateOperation, WorkspaceProtocolPayload, WorkspaceProtocolRequest, WorkspaceProtocolResponse,
};
use std::error::Error;
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::mpsc::UnboundedReceiver;
use tokio::task::JoinHandle;
use uuid::Uuid;

pub const ADMIN_ID: &str = "admin";

/// Standard admin password used across member tests
pub const ADMIN_PASSWORD: &str = "admin_password";

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

/// Helper function to create a test user with specified role
///
/// Creates a test user with:
/// - Formatted name based on ID
/// - Specified user role
/// - Empty permissions map (to be populated by tests)
/// - Default metadata
pub fn create_test_user(id: &str, role: UserRole) -> User {
    User {
        id: id.to_string(),
        name: format!("Test {}", id),
        role,
        permissions: Default::default(),
        metadata: Default::default(),
    }
}

/// Helper to setup a simple test environment for member operations
///
/// Creates a lightweight test environment with:
/// - AsyncWorkspaceServerKernel with admin user pre-configured
/// - AsyncDomainServerOperations for domain management
/// - Logging setup for test debugging
///
/// Returns the kernel and domain operations
pub async fn setup_simple_test_environment() -> (
    Arc<AsyncWorkspaceServerKernel<StackedRatchet>>,
    AsyncDomainServerOperations<StackedRatchet>,
) {
    citadel_logging::setup_log();
    let kernel = Arc::new(
        AsyncWorkspaceServerKernel::<StackedRatchet>::with_workspace_master_password(
            ADMIN_PASSWORD,
        )
        .await
        .expect("Failed to create kernel with admin"),
    );
    let domain_ops = kernel.domain_ops().clone();

    (kernel, domain_ops)
}

/// Sets up the complete test environment with internal service and workspace kernel
pub async fn setup_test_environment() -> Result<
    (
        AsyncWorkspaceServerKernel<StackedRatchet>,
        SocketAddr,
        SocketAddr,
        String,
        String,
    ),
    Box<dyn Error>,
> {
    common::setup_log();

    let bind_address_internal_service: SocketAddr =
        format!("127.0.0.1:{}", get_free_port()).parse().unwrap();

    let (_internal_service, admin_username, admin_password) =
        new_internal_service_with_admin(bind_address_internal_service).await?;

    let workspace_kernel =
        AsyncWorkspaceServerKernel::<StackedRatchet>::with_workspace_master_password(
            &admin_password,
        )
        .await?;

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
    ))
}

/// Registers and connects a user to the test environment
pub async fn register_and_connect_user(
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

/// Sends a workspace command and waits for the response
pub async fn send_workspace_command(
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

/// Creates a test room in the specified office
pub async fn create_test_room(
    to_service: &tokio::sync::mpsc::UnboundedSender<
        citadel_internal_service_types::InternalServiceRequest,
    >,
    from_service: &mut UnboundedReceiver<citadel_internal_service_types::InternalServiceResponse>,
    cid: u64,
    office_id: &str,
) -> Result<String, Box<dyn Error>> {
    let create_room_command = WorkspaceProtocolRequest::CreateRoom {
        office_id: office_id.to_string(),
        name: "Test Room".to_string(),
        description: "A test room".to_string(),
        mdx_content: None,
        metadata: None,
    };

    match send_workspace_command(to_service, from_service, cid, create_room_command).await? {
        WorkspaceProtocolResponse::Room(room) => Ok(room.id),
        other => Err(format!("Unexpected response when creating room: {:?}", other).into()),
    }
}
