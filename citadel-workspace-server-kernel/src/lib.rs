use crate::config::ServerConfig;
use crate::kernel::WorkspaceServerKernel;
use citadel_logging::{info, setup_log};
use citadel_sdk::prelude::{BackendType, NetworkError, NodeBuilder, NodeType, StackedRatchet};
use citadel_workspace_types::{WorkspaceProtocolRequest, WorkspaceProtocolResponse};
use std::net::SocketAddr;

pub mod handlers;
pub mod kernel;

pub const WORKSPACE_ROOT_ID: &str = "workspace-root";
pub const WORKSPACE_MASTER_PASSWORD_KEY: &str = "workspace_master_password";

pub mod config {
    use serde::Deserialize;

    #[derive(Deserialize, Debug, Clone)]
    pub struct ServerConfig {
        pub admin_username: String,
        pub bind_addr: String,
        pub dangerous_skip_cert_verification: Option<bool>,
        pub backend: Option<String>,
        pub workspace_master_password: String,
    }
}

pub async fn run_server(config: ServerConfig) -> Result<(), NetworkError> {
    setup_log();
    info!(target: "citadel", "Starting Citadel Workspace Server Kernel...");

    let backend = if let Some(backend) = config.backend.as_ref() {
        BackendType::new(backend)?
    } else {
        BackendType::InMemory
    };

    let workspace_password = config.workspace_master_password;
    let admin_username = config.admin_username;
    let bind_address_str = config.bind_addr;
    let bind_address: SocketAddr = bind_address_str.parse().map_err(|e| {
        NetworkError::msg(format!(
            "Invalid bind address '{}': {}",
            bind_address_str, e
        ))
    })?;

    let kernel = WorkspaceServerKernel::<StackedRatchet>::with_admin(
        &admin_username, // Pass admin_username as &str
        "Administrator", // Provide a default display name
        &workspace_password,
    );

    let node_type = NodeType::server(bind_address)?;

    let mut builder = NodeBuilder::default();
    builder.with_node_type(node_type).with_backend(backend);

    if config.dangerous_skip_cert_verification.unwrap_or(false) {
        builder.with_insecure_skip_cert_verification();
    }

    // Build and await server execution
    builder.build(kernel)?.await?;

    Ok(())
}
