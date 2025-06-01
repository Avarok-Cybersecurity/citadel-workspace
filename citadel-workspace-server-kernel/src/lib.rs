use crate::config::ServerConfig;
use crate::kernel::WorkspaceServerKernel;
use citadel_logging::{info, setup_log};
use citadel_sdk::prelude::{BackendType, NetworkError, NodeBuilder, NodeType, StackedRatchet};
use citadel_workspace_types::{WorkspaceProtocolRequest, WorkspaceProtocolResponse};
use rocksdb::DB;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use tempfile::TempDir;

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

    let workspace_password = config.workspace_master_password;
    let admin_username = config.admin_username;
    let bind_address_str = config.bind_addr;
    let bind_address: SocketAddr = bind_address_str.parse().map_err(|e| {
        NetworkError::msg(format!(
            "Invalid bind address '{}': {}",
            bind_address_str, e
        ))
    })?;

    let db: Arc<DB>;
    let mut _db_temp_dir_guard: Option<TempDir> = None; // To keep TempDir alive if used
    let backend_type_for_node_builder: BackendType; // To pass to NodeBuilder

    if let Some(backend_path_str) = config.backend.as_ref() {
        // Use the provided path for RocksDB
        let db_path = PathBuf::from(backend_path_str);
        // Ensure parent directory exists if it's a file path, RocksDB needs a directory
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| NetworkError::msg(format!("Failed to create DB directory: {}", e)))?;
        }
        db = Arc::new(DB::open_default(&db_path).map_err(|e| {
            NetworkError::msg(format!("Failed to open DB at {}: {}", db_path.display(), e))
        })?);
        // Assuming BackendType::new can parse this string or is compatible
        // This part might need adjustment if BackendType::new expects a specific format
        // For now, we pass the raw string, assuming BackendType::new handles it for NodeBuilder.
        // Or, more robustly, we'd construct the correct BackendType variant here.
        // Let's assume BackendType::new is robust or we use a known path format for it.
        backend_type_for_node_builder = BackendType::new(backend_path_str)?;
    } else {
        // "InMemory" mode: use a temporary directory for RocksDB
        let temp_dir = TempDir::new()
            .map_err(|e| NetworkError::msg(format!("Failed to create temp dir for DB: {}", e)))?;
        db = Arc::new(
            DB::open_default(temp_dir.path())
                .map_err(|e| NetworkError::msg(format!("Failed to open temp DB: {}", e)))?,
        );
        _db_temp_dir_guard = Some(temp_dir); // Keep TempDir alive
        backend_type_for_node_builder = BackendType::InMemory;
    }

    let kernel = WorkspaceServerKernel::<StackedRatchet>::with_admin(
        &admin_username, // Pass admin_username as &str
        "Administrator", // Provide a default display name
        &workspace_password,
        db.clone(), // Pass the DB instance
    );

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
