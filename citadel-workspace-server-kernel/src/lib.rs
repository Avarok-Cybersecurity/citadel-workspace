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
    //
    // Debug is implemented manually below to redact
    // `workspace_master_password`. Deriving Debug here would dump the
    // password in plaintext when `info!(?config, ...)` formats the
    // value — and that line runs at the production INFO level on
    // every boot, so the secret would land in `docker compose logs`
    // and any log aggregator the operator wires up.
    #[derive(Deserialize, Clone)]
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

    impl std::fmt::Debug for ServerConfig {
        fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            // Marker, not the password length, so `{:?}` output gives
            // zero signal about the secret. Distinguish "set" from
            // "empty" because an empty value usually means the env
            // override missed — useful in startup diagnostics — while
            // still never echoing the real string.
            let password_state = if self.workspace_master_password.is_empty() {
                "<empty>"
            } else {
                "<redacted>"
            };
            f.debug_struct("ServerConfig")
                .field("bind_addr", &self.bind_addr)
                .field(
                    "dangerous_skip_cert_verification",
                    &self.dangerous_skip_cert_verification,
                )
                .field("backend", &self.backend)
                .field("data_dir", &self.data_dir)
                .field("workspace_master_password", &password_state)
                .field("workspace_structure", &self.workspace_structure)
                .field("content_base_dir", &self.content_base_dir)
                .field("file_transfer", &self.file_transfer)
                .finish()
        }
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
    // Allow the bind address to be overridden via env so the same baked-in
    // kernel.toml (0.0.0.0 for dev bridge networking) can be pinned to
    // loopback in production under host networking (WORKSPACE_BIND_ADDR=
    // 127.0.0.1:12349), keeping the Citadel listener off public interfaces.
    let bind_address_str = std::env::var("WORKSPACE_BIND_ADDR")
        .ok()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| config.bind_addr.clone());
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
    let backend_type_for_node_builder = select_backend_type(
        std::env::var("WORKSPACE_BACKEND").ok().as_deref(),
        std::env::var("WORKSPACE_DATA_DIR").ok().as_deref(),
        config.backend.as_deref(),
        config.data_dir.as_deref(),
    )?;

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
        // `with_insecure_skip_cert_verification` is `&mut self -> &mut Self`
        // (see citadel_sdk::builder::node_builder), so the call mutates
        // `builder` in place — discarding the returned `&mut Self` is
        // intentional and correct, not a bug. The static analysers that
        // flag this expect a `self -> Self` consuming-builder pattern;
        // the SDK builder uses the in-place variant.
        builder.with_insecure_skip_cert_verification();
    }

    // Build and await server execution
    builder.build(kernel)?.await?;

    Ok(())
}

/// Resolve the backend type from the four possible sources, in
/// precedence order: env-var first, config-file second, and a
/// default of `InMemory` if neither is set.
///
/// Why env wins: the same Dockerfile COPY is shared between the dev
/// `tilt` flow and the production compose file, so `kernel.toml`
/// CANNOT default to filesystem without breaking CLAUDE.md's
/// documented ephemeral-dev contract (every dev reload would persist
/// state, masking issues that only surface on a fresh server).
/// Production `docker-compose.production.yml` sets the env vars to
/// override that default, keeping prod on disk and dev in memory.
///
/// Side effects are limited to structured logging via `info!()` —
/// no filesystem or network I/O. Unit tests can drive every
/// combination of env/config inputs through the public surface and
/// the `info!` calls are no-ops without a configured subscriber.
pub fn select_backend_type(
    env_backend: Option<&str>,
    env_data_dir: Option<&str>,
    config_backend: Option<&str>,
    config_data_dir: Option<&str>,
) -> Result<BackendType, NetworkError> {
    // Treat empty strings the same as "unset". `std::env::var().ok()`
    // returns `Some("")` for a defined-but-empty env var, and TOML
    // config can carry the same (e.g. `data_dir = ""`). Without this
    // filter, `WORKSPACE_DATA_DIR=""` short-circuits the `.or()` chain
    // and produces `BackendType::Filesystem("")`, silently writing data
    // to the container CWD instead of falling through to config or the
    // documented `./data` default.
    let env_backend = env_backend.filter(|s| !s.is_empty());
    let env_data_dir = env_data_dir.filter(|s| !s.is_empty());
    let config_backend = config_backend.filter(|s| !s.is_empty());
    let config_data_dir = config_data_dir.filter(|s| !s.is_empty());
    let backend_choice = env_backend.or(config_backend);
    let data_dir_choice = env_data_dir.or(config_data_dir);
    match backend_choice {
        Some("filesystem") => {
            let data_dir = data_dir_choice.unwrap_or("./data").to_string();
            info!(target: "citadel", "Using filesystem backend with data directory: {}", data_dir);
            Ok(BackendType::Filesystem(data_dir))
        }
        Some(other) => Err(NetworkError::msg(format!(
            "Unknown backend type '{}'. Supported: 'filesystem' (or omit for in-memory)",
            other
        ))),
        None => {
            info!(target: "citadel", "Using in-memory backend (data will not persist across restarts)");
            Ok(BackendType::InMemory)
        }
    }
}

#[cfg(test)]
mod backend_select_tests {
    //! Boundary tests for `select_backend_type`. The selection logic
    //! is the main reason a deployment ends up on the wrong backend
    //! (in-memory in production, filesystem in dev), so each
    //! precedence path has its own assertion. The function is pure,
    //! so the tests don't need a kernel or runtime.
    use super::*;

    #[test]
    fn defaults_to_in_memory_when_nothing_is_set() {
        let bt = select_backend_type(None, None, None, None).unwrap();
        assert!(matches!(bt, BackendType::InMemory));
    }

    #[test]
    fn config_filesystem_uses_config_data_dir() {
        let bt = select_backend_type(None, None, Some("filesystem"), Some("/srv/data")).unwrap();
        match bt {
            BackendType::Filesystem(d) => assert_eq!(d, "/srv/data"),
            other => panic!("expected Filesystem, got {other:?}"),
        }
    }

    #[test]
    fn config_filesystem_falls_back_to_default_data_dir() {
        let bt = select_backend_type(None, None, Some("filesystem"), None).unwrap();
        match bt {
            BackendType::Filesystem(d) => assert_eq!(d, "./data"),
            other => panic!("expected Filesystem, got {other:?}"),
        }
    }

    #[test]
    fn env_backend_overrides_config_backend() {
        let bt =
            select_backend_type(Some("filesystem"), Some("/data/from-env"), None, None).unwrap();
        match bt {
            BackendType::Filesystem(d) => assert_eq!(d, "/data/from-env"),
            other => panic!("expected Filesystem, got {other:?}"),
        }
    }

    #[test]
    fn env_data_dir_overrides_config_data_dir_independently() {
        // The env-var precedence applies to backend AND data-dir
        // independently — operators should be able to keep
        // backend=filesystem from config but redirect data-dir from
        // env (e.g. switching to a mounted volume without rebuilding
        // the image).
        let bt = select_backend_type(
            None,
            Some("/mnt/persistent"),
            Some("filesystem"),
            Some("/srv/data"),
        )
        .unwrap();
        match bt {
            BackendType::Filesystem(d) => assert_eq!(d, "/mnt/persistent"),
            other => panic!("expected Filesystem, got {other:?}"),
        }
    }

    #[test]
    fn unknown_backend_string_returns_error() {
        let err = select_backend_type(None, None, Some("redis"), None).unwrap_err();
        let msg = format!("{err}");
        assert!(
            msg.contains("Unknown backend type 'redis'"),
            "error message should name the bad value: {msg}"
        );
    }

    #[test]
    fn explicit_in_memory_via_omitted_backend_ignores_data_dir() {
        // If the operator omits the backend entirely (intending
        // in-memory), a stray data-dir env var must not silently
        // promote them to filesystem.
        let bt = select_backend_type(None, Some("/should-be-ignored"), None, None).unwrap();
        assert!(matches!(bt, BackendType::InMemory));
    }

    #[test]
    fn empty_env_data_dir_falls_through_to_config_then_default() {
        // `WORKSPACE_DATA_DIR=""` in `.env` previously short-circuited
        // the `.or()` and produced `BackendType::Filesystem("")`,
        // silently writing data to the container CWD instead of the
        // configured volume. With the empty-string filter the env
        // value is ignored and config wins.
        let bt =
            select_backend_type(Some("filesystem"), Some(""), None, Some("/srv/data")).unwrap();
        match bt {
            BackendType::Filesystem(d) => assert_eq!(d, "/srv/data"),
            other => panic!("expected Filesystem(/srv/data), got {other:?}"),
        }
    }

    #[test]
    fn empty_env_data_dir_with_no_config_falls_through_to_default() {
        let bt = select_backend_type(Some("filesystem"), Some(""), None, None).unwrap();
        match bt {
            BackendType::Filesystem(d) => assert_eq!(d, "./data"),
            other => panic!("expected Filesystem(./data), got {other:?}"),
        }
    }

    #[test]
    fn empty_env_backend_treated_as_unset() {
        // `WORKSPACE_BACKEND=""` should NOT be reported as an unknown
        // backend; it should fall through to config or default.
        let bt = select_backend_type(Some(""), None, Some("filesystem"), Some("/x")).unwrap();
        match bt {
            BackendType::Filesystem(d) => assert_eq!(d, "/x"),
            other => panic!("expected Filesystem(/x), got {other:?}"),
        }
    }

    #[test]
    fn empty_config_data_dir_falls_through_to_default() {
        let bt = select_backend_type(None, None, Some("filesystem"), Some("")).unwrap();
        match bt {
            BackendType::Filesystem(d) => assert_eq!(d, "./data"),
            other => panic!("expected Filesystem(./data), got {other:?}"),
        }
    }
}

#[cfg(test)]
mod server_config_debug_tests {
    //! Pin the secret-redaction contract for `ServerConfig`'s Debug
    //! impl. `main.rs` logs the full config at INFO on every boot, so
    //! a regression here ships the master password into operator log
    //! pipelines. If someone re-adds `#[derive(Debug)]` or forgets a
    //! field in the manual impl, these tests fail loudly.
    use super::config::{FileTransferConfig, ServerConfig};

    fn cfg(password: &str) -> ServerConfig {
        ServerConfig {
            bind_addr: "0.0.0.0:12349".to_string(),
            dangerous_skip_cert_verification: Some(true),
            backend: Some("filesystem".to_string()),
            data_dir: Some("/srv/data".to_string()),
            workspace_master_password: password.to_string(),
            workspace_structure: None,
            content_base_dir: Some("/srv/content".to_string()),
            file_transfer: Some(FileTransferConfig::default()),
        }
    }

    #[test]
    fn debug_never_emits_the_password_substring() {
        let secret = "hunter2-extremely-distinctive-string";
        let formatted = format!("{:?}", cfg(secret));
        assert!(
            !formatted.contains(secret),
            "Debug output leaked the master password: {formatted}"
        );
    }

    #[test]
    fn debug_marks_set_passwords_as_redacted() {
        let formatted = format!("{:?}", cfg("anything-non-empty"));
        assert!(
            formatted.contains("<redacted>"),
            "expected <redacted> marker in {formatted}"
        );
    }

    #[test]
    fn debug_marks_empty_passwords_as_empty() {
        let formatted = format!("{:?}", cfg(""));
        assert!(
            formatted.contains("<empty>"),
            "expected <empty> marker in {formatted}"
        );
        assert!(
            !formatted.contains("<redacted>"),
            "should not mark empty as <redacted>: {formatted}"
        );
    }
}
