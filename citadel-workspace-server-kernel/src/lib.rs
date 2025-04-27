pub use citadel_workspace_types::{WorkspaceProtocolRequest, WorkspaceProtocolResponse};
pub use kernel::WorkspaceServerKernel;
pub use citadel_sdk::prelude::*;
use crate::config::ServerConfig; // Import the config struct
use citadel_logging::info;

pub mod handlers;
pub mod kernel;
#[cfg(test)]
pub mod tests;

pub const WORKSPACE_ROOT_ID: &str = "workspace-root";

pub mod config {
    use serde::Deserialize;
    use std::net::SocketAddr;

    // Define the structure for the TOML configuration file
    #[derive(Deserialize, Debug, Clone)]
    pub struct ServerConfig {
        pub admin_username: String,
        pub bind_address: SocketAddr,
        pub dangerous_skip_cert_verification: Option<bool>,
        pub backend: Option<String>,
        pub admin_otp: String,
    }
}

// Update start_server to accept ServerConfig
pub async fn start_server(config: ServerConfig) -> Result<(), NetworkError> {
    info!("Starting Citadel Workspace Server Kernel...");

    // Extract values from config
    let admin_username = config.admin_username.clone(); // Clone if needed later
    let admin_otp = config.admin_otp.clone(); // Clone if needed later

    let backend = if let Some(backend_uri) = config.backend.as_deref() {
        BackendType::new(backend_uri)?
    } else {
        BackendType::InMemory
    };

    // Create the workspace server kernel with an admin user
    let service = WorkspaceServerKernel::<StackedRatchet>::with_admin(&admin_username, "Administrator");
    let mut builder = NodeBuilder::default();
    let mut builder = builder
        .with_backend(backend)
        .with_node_type(NodeType::server(config.bind_address)?);

    if config.dangerous_skip_cert_verification.unwrap_or(false) {
        builder = builder.with_insecure_skip_cert_verification()
    }

    builder.build(service)?.await?;
    Ok(())
}
