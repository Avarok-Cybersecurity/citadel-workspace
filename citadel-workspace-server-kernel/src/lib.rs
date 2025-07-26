use crate::config::ServerConfig;
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
        pub bind_addr: String,
        pub dangerous_skip_cert_verification: Option<bool>,
        pub backend: Option<String>,
        pub workspace_master_password: String,
    }
}

pub async fn run_server(config: ServerConfig) -> Result<(), NetworkError> {
    setup_log();
    info!(target: "citadel", "Starting Citadel Workspace Server Kernel...");

    let workspace_password = config.workspace_master_password;
    let bind_address_str = config.bind_addr;
    let bind_address: SocketAddr = bind_address_str.parse().map_err(|e| {
        NetworkError::msg(format!(
            "Invalid bind address '{}': {}",
            bind_address_str, e
        ))
    })?;

    // Always use in-memory backend for now
    let backend_type_for_node_builder = BackendType::InMemory;

    // Create AsyncWorkspaceServerKernel with admin user from config
    let kernel = kernel::async_kernel::AsyncWorkspaceServerKernel::<StackedRatchet>::with_workspace_master_password(
        &workspace_password,
    ).await?;

    let node_type = NodeType::server(bind_address)?;

    let mut builder = NodeBuilder::default();
    builder
        .with_node_type(node_type)
        .with_backend(backend_type_for_node_builder);

    if config.dangerous_skip_cert_verification.unwrap_or(false) {
        builder.with_insecure_skip_cert_verification();
    }

    // Build and await server execution
    builder.build(kernel)?.await?;

    Ok(())
}
