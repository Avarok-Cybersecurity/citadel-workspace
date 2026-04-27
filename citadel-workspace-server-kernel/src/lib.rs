use crate::config::{ServerConfig, WorkspaceStructureConfig};
use citadel_logging::{info, setup_log};
use citadel_sdk::prelude::{BackendType, NetworkError, NodeBuilder, NodeType, StackedRatchet};
use citadel_workspace_types::{WorkspaceProtocolRequest, WorkspaceProtocolResponse};
use std::net::SocketAddr;
use std::path::Path;

pub mod handlers;
pub mod kernel;

pub const WORKSPACE_ROOT_ID: &str = "workspace-root";
pub const WORKSPACE_MASTER_PASSWORD_KEY: &str = "workspace_master_password";

pub mod config {
    use citadel_workspace_types::structs::DomainPermissions;
    use serde::Deserialize;

    /// Main server configuration from kernel.toml
    #[derive(Deserialize, Debug, Clone)]
    pub struct ServerConfig {
        pub bind_addr: String,
        pub dangerous_skip_cert_verification: Option<bool>,
        pub backend: Option<String>,
        /// Data directory for filesystem backend (defaults to "./data")
        pub data_dir: Option<String>,
        /// Workspace master password. Can be overridden by WORKSPACE_MASTER_PASSWORD env var.
        /// Server refuses to start if neither config nor env var provides a non-empty password.
        #[serde(default)]
        pub workspace_master_password: String,
        /// Path to the workspace structure JSON file (relative to kernel.toml)
        /// DEPRECATED: Use content_base_dir instead
        pub workspace_structure: Option<String>,
        /// Path to directory containing workspace.json and office/room CONTENT.md files
        /// The directory structure defines offices (subdirs) and rooms (nested subdirs)
        pub content_base_dir: Option<String>,
        /// File transfer configuration
        pub file_transfer: Option<FileTransferConfig>,
    }

    /// File transfer configuration section
    #[derive(Deserialize, Debug, Clone)]
    pub struct FileTransferConfig {
        /// Enable server-mediated file transfers
        #[serde(default = "default_true")]
        pub allow_server_file_transfer: bool,
        /// Enable RE-VFS (Remote Encrypted Virtual File System) storage
        #[serde(default = "default_true")]
        pub allow_server_revfs_storage: bool,
        /// Maximum file size for transfers (in megabytes)
        #[serde(default = "default_max_file_size")]
        pub max_file_transfer_size_mb: u64,
        /// RE-VFS storage quota per peer (in megabytes)
        #[serde(default = "default_revfs_quota")]
        pub revfs_storage_quota_mb: u64,
        /// File transfer request TTL (in days)
        #[serde(default = "default_file_ttl")]
        pub file_ttl_days: u32,
    }

    fn default_true() -> bool {
        true
    }
    fn default_max_file_size() -> u64 {
        100
    }
    fn default_revfs_quota() -> u64 {
        100
    }
    fn default_file_ttl() -> u32 {
        7
    }

    impl Default for FileTransferConfig {
        fn default() -> Self {
            Self {
                allow_server_file_transfer: true,
                allow_server_revfs_storage: true,
                max_file_transfer_size_mb: 100,
                revfs_storage_quota_mb: 100,
                file_ttl_days: 7,
            }
        }
    }

    /// Workspace structure configuration from workspaces.json
    #[derive(Deserialize, Debug, Clone)]
    pub struct WorkspaceStructureConfig {
        pub name: String,
        pub description: Option<String>,
        pub offices: Vec<OfficeConfig>,
    }

    /// Office configuration
    #[derive(Deserialize, Debug, Clone)]
    pub struct OfficeConfig {
        pub name: String,
        pub description: Option<String>,
        /// Path to markdown file for the office landing page
        pub markdown_file: Option<String>,
        /// Whether group chat is enabled for this office
        #[serde(default)]
        pub chat_enabled: bool,
        /// Rules displayed to users
        pub rules: Option<String>,
        /// Default permissions for users in this office
        #[serde(default)]
        pub default_permissions: DomainPermissions,
        /// Whether this is the default office for the workspace (navigated to on login)
        #[serde(default)]
        pub is_default: bool,
        /// Nested rooms within this office
        #[serde(default)]
        pub rooms: Vec<RoomConfig>,
    }

    /// Room configuration
    #[derive(Deserialize, Debug, Clone)]
    pub struct RoomConfig {
        pub name: String,
        pub description: Option<String>,
        /// Path to markdown file for the room landing page
        pub markdown_file: Option<String>,
        /// Whether group chat is enabled for this room
        #[serde(default)]
        pub chat_enabled: bool,
        /// Rules displayed to users
        pub rules: Option<String>,
        /// Default permissions for users in this room
        #[serde(default)]
        pub default_permissions: DomainPermissions,
    }

    impl WorkspaceStructureConfig {
        /// Load workspace structure from a JSON file
        pub fn from_file(path: &std::path::Path) -> Result<Self, String> {
            let content = std::fs::read_to_string(path)
                .map_err(|e| format!("Failed to read workspace structure file: {}", e))?;
            serde_json::from_str(&content)
                .map_err(|e| format!("Failed to parse workspace structure JSON: {}", e))
        }

        /// Load workspace structure from a directory hierarchy
        ///
        /// The directory must contain:
        /// - workspace.json: Workspace metadata (name, description)
        /// - Subdirectories: Each becomes an office
        /// - Nested subdirectories: Each becomes a room within its parent office
        /// - CONTENT.md files: Required for each office and room
        pub fn from_directory(base_dir: &std::path::Path) -> Result<Self, String> {
            use std::fs;

            // Validate base directory exists
            if !base_dir.is_dir() {
                return Err(format!(
                    "Content base directory does not exist: {:?}",
                    base_dir
                ));
            }

            // Load workspace.json for metadata
            let workspace_json_path = base_dir.join("workspace.json");
            if !workspace_json_path.exists() {
                return Err(format!("workspace.json not found in {:?}", base_dir));
            }

            let workspace_json_content = fs::read_to_string(&workspace_json_path)
                .map_err(|e| format!("Failed to read workspace.json: {}", e))?;

            let workspace_meta: serde_json::Value =
                serde_json::from_str(&workspace_json_content)
                    .map_err(|e| format!("Failed to parse workspace.json: {}", e))?;

            let workspace_name = workspace_meta
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or("Workspace")
                .to_string();

            let workspace_description = workspace_meta
                .get("description")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());

            // Scan subdirectories for offices
            let mut offices = Vec::new();
            let mut errors = Vec::new();

            let entries = fs::read_dir(base_dir)
                .map_err(|e| format!("Failed to read directory {:?}: {}", base_dir, e))?;

            for entry in entries {
                let entry = entry.map_err(|e| format!("Failed to read directory entry: {}", e))?;
                let path = entry.path();

                // Skip non-directories and hidden files
                if !path.is_dir() || entry.file_name().to_string_lossy().starts_with('.') {
                    continue;
                }

                let office_name = entry.file_name().to_string_lossy().to_string();

                // Validate CONTENT.md exists for office
                let office_content_path = path.join("CONTENT.md");
                if !office_content_path.exists() {
                    errors.push(format!("Missing CONTENT.md for office '{}'", office_name));
                    continue;
                }

                // Load office CONTENT.md
                let office_content = fs::read_to_string(&office_content_path).map_err(|e| {
                    format!("Failed to read {}: {}", office_content_path.display(), e)
                })?;

                // Scan for rooms (subdirectories)
                let mut rooms = Vec::new();
                let room_entries = fs::read_dir(&path)
                    .map_err(|e| format!("Failed to read office directory {:?}: {}", path, e))?;

                for room_entry in room_entries {
                    let room_entry =
                        room_entry.map_err(|e| format!("Failed to read room entry: {}", e))?;
                    let room_path = room_entry.path();

                    // Skip non-directories and hidden files
                    if !room_path.is_dir()
                        || room_entry.file_name().to_string_lossy().starts_with('.')
                    {
                        continue;
                    }

                    let room_name = room_entry.file_name().to_string_lossy().to_string();

                    // Validate CONTENT.md exists for room
                    let room_content_path = room_path.join("CONTENT.md");
                    if !room_content_path.exists() {
                        errors.push(format!(
                            "Missing CONTENT.md for room '{}' in office '{}'",
                            room_name, office_name
                        ));
                        continue;
                    }

                    // Load room CONTENT.md
                    let room_content = fs::read_to_string(&room_content_path).map_err(|e| {
                        format!("Failed to read {}: {}", room_content_path.display(), e)
                    })?;

                    // Extract first paragraph as description
                    let room_description = Self::extract_description(&room_content);

                    rooms.push(RoomConfig {
                        name: room_name,
                        description: room_description,
                        markdown_file: Some(room_content_path.to_string_lossy().to_string()),
                        chat_enabled: true, // Default to enabled
                        rules: None,
                        default_permissions: DomainPermissions::default(),
                    });
                }

                // Sort rooms alphabetically
                rooms.sort_by(|a, b| a.name.cmp(&b.name));

                // Extract first paragraph as description
                let office_description = Self::extract_description(&office_content);

                offices.push(OfficeConfig {
                    name: office_name,
                    description: office_description,
                    markdown_file: Some(office_content_path.to_string_lossy().to_string()),
                    chat_enabled: true, // Default to enabled
                    rules: None,
                    default_permissions: DomainPermissions::default(),
                    rooms,
                    is_default: false, // Will be set based on validation in initialize_workspace_structure
                });
            }

            // Sort offices alphabetically
            offices.sort_by(|a, b| a.name.cmp(&b.name));

            // Report any validation errors
            if !errors.is_empty() {
                return Err(format!("Validation errors:\n  - {}", errors.join("\n  - ")));
            }

            if offices.is_empty() {
                return Err(format!("No offices found in {:?}. Each subdirectory with a CONTENT.md becomes an office.", base_dir));
            }

            Ok(WorkspaceStructureConfig {
                name: workspace_name,
                description: workspace_description,
                offices,
            })
        }

        /// Extract a description from markdown content (first non-header paragraph)
        fn extract_description(content: &str) -> Option<String> {
            let lines: Vec<&str> = content.lines().collect();
            let mut in_paragraph = false;
            let mut description_lines = Vec::new();

            for line in lines {
                let trimmed = line.trim();

                // Skip headers
                if trimmed.starts_with('#') {
                    in_paragraph = false;
                    description_lines.clear();
                    continue;
                }

                // Skip empty lines at the start
                if trimmed.is_empty() {
                    if in_paragraph {
                        // End of paragraph
                        break;
                    }
                    continue;
                }

                // Skip horizontal rules
                if trimmed.starts_with("---") || trimmed.starts_with("***") {
                    break;
                }

                in_paragraph = true;
                description_lines.push(trimmed);
            }

            if description_lines.is_empty() {
                None
            } else {
                Some(description_lines.join(" "))
            }
        }
    }
}

/// Run the workspace server with the given configuration.
///
/// If `config_base_path` is provided, it is used to resolve relative paths in the config.
/// This is typically the directory containing kernel.toml.
pub async fn run_server(config: ServerConfig) -> Result<(), NetworkError> {
    run_server_with_base_path(config, None).await
}

/// Run the workspace server with the given configuration and base path.
pub async fn run_server_with_base_path(
    config: ServerConfig,
    config_base_path: Option<&Path>,
) -> Result<(), NetworkError> {
    setup_log();
    info!(target: "citadel", "Starting Citadel Workspace Server Kernel...");

    let workspace_password = config.workspace_master_password.clone();
    let bind_address_str = config.bind_addr.clone();
    let bind_address: SocketAddr = bind_address_str.parse().map_err(|e| {
        NetworkError::msg(format!(
            "Invalid bind address '{}': {}",
            bind_address_str, e
        ))
    })?;

    // Load workspace structure config - prefer content_base_dir over workspace_structure
    let workspace_structure = if let Some(content_dir) = &config.content_base_dir {
        // New directory-based configuration
        let full_path = if let Some(base) = config_base_path {
            base.join(content_dir)
        } else {
            std::path::PathBuf::from(content_dir)
        };

        info!(target: "citadel", "Loading workspace structure from directory: {:?}", full_path);
        match WorkspaceStructureConfig::from_directory(&full_path) {
            Ok(structure) => {
                info!(target: "citadel", "Loaded workspace structure: {} with {} offices (directory-based)",
                    structure.name, structure.offices.len());
                for office in &structure.offices {
                    info!(target: "citadel", "  - Office '{}' with {} rooms",
                        office.name, office.rooms.len());
                }
                Some((structure, Some(full_path)))
            }
            Err(e) => {
                return Err(NetworkError::msg(format!(
                    "Failed to load workspace structure from directory: {}",
                    e
                )));
            }
        }
    } else if let Some(structure_path) = &config.workspace_structure {
        // Legacy JSON file configuration
        let full_path = if let Some(base) = config_base_path {
            base.join(structure_path)
        } else {
            std::path::PathBuf::from(structure_path)
        };

        info!(target: "citadel", "Loading workspace structure from file: {:?} (deprecated, use content_base_dir)", full_path);
        match WorkspaceStructureConfig::from_file(&full_path) {
            Ok(structure) => {
                info!(target: "citadel", "Loaded workspace structure: {} with {} offices",
                    structure.name, structure.offices.len());
                Some((structure, full_path.parent().map(|p| p.to_path_buf())))
            }
            Err(e) => {
                info!(target: "citadel", "Warning: Failed to load workspace structure: {}. Continuing without pre-configured structure.", e);
                None
            }
        }
    } else {
        info!(target: "citadel", "No workspace structure configured. Use content_base_dir or workspace_structure in kernel.toml");
        None
    };

    // Select backend type from env-var override (preferred) or config file.
    //
    // Env vars win because:
    //   * dev `kernel.toml` is shared with prod via the same Dockerfile
    //     COPY, so the file CANNOT default to filesystem without
    //     persisting state across `tilt` restarts in dev (contradicting
    //     CLAUDE.md's documented ephemeral-dev contract).
    //   * Production `docker-compose.production.yml` sets the env vars,
    //     keeping production state on disk while dev stays ephemeral.
    //
    // Defaults to InMemory when neither env var nor config sets it -
    // matching the prior "omit = in-memory" contract.
    let env_backend = std::env::var("WORKSPACE_BACKEND").ok();
    let env_data_dir = std::env::var("WORKSPACE_DATA_DIR").ok();
    let backend_choice = env_backend.as_deref().or(config.backend.as_deref());
    let data_dir_choice = env_data_dir.as_deref().or(config.data_dir.as_deref());
    let backend_type_for_node_builder = match backend_choice {
        Some("filesystem") => {
            let data_dir = data_dir_choice.unwrap_or("./data").to_string();
            info!(target: "citadel", "Using filesystem backend with data directory: {}", data_dir);
            BackendType::Filesystem(data_dir.into())
        }
        Some(other) => {
            return Err(NetworkError::msg(format!(
                "Unknown backend type '{}'. Supported: 'filesystem' (or omit for in-memory)",
                other
            )));
        }
        None => {
            info!(target: "citadel", "Using in-memory backend (data will not persist across restarts)");
            BackendType::InMemory
        }
    };

    // Log file transfer config
    if let Some(ref ft_config) = config.file_transfer {
        info!(target: "citadel", "File transfer config: server_transfer={}, revfs_storage={}, max_size={}MB, quota={}MB",
            ft_config.allow_server_file_transfer,
            ft_config.allow_server_revfs_storage,
            ft_config.max_file_transfer_size_mb,
            ft_config.revfs_storage_quota_mb);
    } else {
        info!(target: "citadel", "No file transfer config specified, using defaults");
    }

    // Create AsyncWorkspaceServerKernel with admin user from config
    let kernel = kernel::async_kernel::AsyncWorkspaceServerKernel::<StackedRatchet>::with_workspace_master_password_and_structure_and_file_transfer(
        &workspace_password,
        workspace_structure,
        config.file_transfer.clone(),
    ).await?;

    let node_type = NodeType::server(bind_address)?;

    let mut builder = NodeBuilder::default();
    builder
        .with_node_type(node_type)
        .with_backend(backend_type_for_node_builder);

    if config.dangerous_skip_cert_verification.unwrap_or(false) {
        citadel_logging::warn!(target: "citadel", "⚠️  SECURITY WARNING: TLS certificate verification is DISABLED. This should ONLY be used for local development with self-signed certificates. Never use in production!");
        builder.with_insecure_skip_cert_verification();
    }

    // Build and await server execution
    builder.build(kernel)?.await?;

    Ok(())
}
