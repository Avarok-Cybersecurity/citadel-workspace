//! # Async Workspace Server Kernel
//!
//! This module provides the async version of WorkspaceServerKernel that uses
//! the BackendTransactionManager for all persistence operations.

use crate::config::{FileTransferConfig, WorkspaceStructureConfig};
use crate::handlers::domain::server_ops::async_domain_server_ops::AsyncDomainServerOperations;
use crate::kernel::rate_limiter::{RateLimiter, DEFAULT_RATE_LIMIT_MAX, DEFAULT_RATE_LIMIT_REFILL};
use crate::kernel::transaction::BackendTransactionManager;
use crate::WorkspaceProtocolResponse;
use citadel_logging::{error, info, warn};
use citadel_sdk::prelude::{NetworkError, NodeRemote, NodeResult, ObjectTransferStatus, Ratchet};
use parking_lot::RwLock;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::broadcast;

/// Current schema version for the workspace backend storage.
/// Increment this when making breaking changes to the storage format.
/// The `on_start` method checks this version and runs migrations if needed.
pub const CURRENT_SCHEMA_VERSION: u32 = 1;

/// Reject a path segment supplied by an authenticated client before it
/// is joined onto the content base directory. Without this check, a
/// node/office/room name like `"../../etc/evil"` would let
/// `tokio::fs::write` escape the configured content tree and clobber
/// arbitrary files as the server process user.
///
/// Rules: a content segment is rejected if it
///   * is empty,
///   * is exactly `.` or `..` (current/parent dir traversal),
///   * contains a path separator (`/` or `\`) — either form is taken
///     as an attempt to climb the tree even on a Linux host, since
///     `Path::join` interprets a leading slash as an absolute root,
///   * contains a NUL byte (truncates filesystem syscalls), or
///   * starts with `.` (hidden / special directories like `.git`,
///     `.ssh`, `..`).
///
/// All real workspace/office/room names today are user-visible labels
/// that the UI should already prevent from containing these
/// characters — this is a belt-and-suspenders check at the persistence
/// boundary so a compromised or misbehaving client can't reach a
/// `tokio::fs::write` outside the content directory.
pub(crate) fn validate_content_segment(segment: &str) -> Result<(), NetworkError> {
    if segment.is_empty() {
        return Err(NetworkError::msg("Content segment cannot be empty"));
    }
    if segment == "." || segment == ".." {
        return Err(NetworkError::msg(format!(
            "Content segment '{segment}' is a directory traversal sentinel"
        )));
    }
    if segment.starts_with('.') {
        return Err(NetworkError::msg(format!(
            "Content segment '{segment}' must not start with '.'"
        )));
    }
    if segment.contains('/') || segment.contains('\\') || segment.contains('\0') {
        return Err(NetworkError::msg(format!(
            "Content segment '{segment}' contains a forbidden character"
        )));
    }
    Ok(())
}

/// Message for broadcasting workspace updates to connected clients
#[derive(Clone, Debug)]
pub struct BroadcastMessage {
    /// The response to broadcast
    pub response: WorkspaceProtocolResponse,
    /// The CID to exclude from the broadcast (the originator)
    pub exclude_cid: Option<u64>,
}

/// Async version of WorkspaceServerKernel that uses backend persistence
pub struct AsyncWorkspaceServerKernel<R: Ratchet> {
    /// Network node remote for handling connections
    pub node_remote: Arc<RwLock<Option<NodeRemote<R>>>>,
    /// Async domain operations handler
    pub domain_operations: AsyncDomainServerOperations<R>,
    /// Workspace password (stored temporarily for on_start)
    workspace_password: Option<String>,
    /// Workspace structure config (stored temporarily for on_start)
    workspace_structure: Option<(WorkspaceStructureConfig, Option<PathBuf>)>,
    /// Broadcast channel for sending updates to all connected clients
    broadcast_tx: broadcast::Sender<BroadcastMessage>,
    /// File transfer configuration
    file_transfer_config: FileTransferConfig,
    /// Per-CID token-bucket rate limiter shared across all connection
    /// tasks. The shared map is what makes the limit per-CID rather than
    /// per-connection - opening multiple connections from the same
    /// account no longer multiplies the budget.
    rate_limiter: RateLimiter,
}

// Placeholder for entities that don't have an owner yet.
// The first user to provide the master password via UpdateWorkspace becomes the owner.
pub const UNASSIGNED_OWNER: &str = "";

impl<R: Ratchet> Clone for AsyncWorkspaceServerKernel<R> {
    fn clone(&self) -> Self {
        Self {
            node_remote: self.node_remote.clone(),
            domain_operations: self.domain_operations.clone(),
            workspace_password: self.workspace_password.clone(),
            workspace_structure: self.workspace_structure.clone(),
            broadcast_tx: self.broadcast_tx.clone(),
            file_transfer_config: self.file_transfer_config.clone(),
            // RateLimiter::Clone shares the same Arc<Mutex<HashMap>>,
            // which is exactly what we want: every clone of the kernel
            // sees the same per-CID buckets.
            rate_limiter: self.rate_limiter.clone(),
        }
    }
}

impl<R: Ratchet + Send + Sync + 'static> AsyncWorkspaceServerKernel<R> {
    /// Create a new AsyncWorkspaceServerKernel with backend persistence
    pub fn new(node_remote: Option<NodeRemote<R>>) -> Self {
        info!(target: "citadel", "Creating AsyncWorkspaceServerKernel with backend persistence");

        let node_remote_arc = Arc::new(RwLock::new(node_remote));

        // Create BackendTransactionManager
        let backend_tx_manager = Arc::new(BackendTransactionManager::new());

        // Set node remote in backend tx manager if available
        if let Some(nr) = node_remote_arc.read().clone() {
            backend_tx_manager.set_node_remote(nr);
        }

        // Create async domain operations with backend
        let domain_operations =
            AsyncDomainServerOperations::new(backend_tx_manager, node_remote_arc.clone());

        // Create broadcast channel with capacity for 100 messages
        let (broadcast_tx, _) = broadcast::channel(100);

        Self {
            node_remote: node_remote_arc,
            domain_operations,
            workspace_password: None,
            workspace_structure: None,
            broadcast_tx,
            file_transfer_config: FileTransferConfig::default(),
            rate_limiter: RateLimiter::new(DEFAULT_RATE_LIMIT_MAX, DEFAULT_RATE_LIMIT_REFILL),
        }
    }

    /// Create a new kernel with file transfer configuration
    pub fn with_file_transfer_config(
        node_remote: Option<NodeRemote<R>>,
        file_transfer_config: Option<FileTransferConfig>,
    ) -> Self {
        let mut kernel = Self::new(node_remote);
        if let Some(config) = file_transfer_config {
            kernel.file_transfer_config = config;
        }
        kernel
    }

    /// Get the file transfer configuration
    pub fn file_transfer_config(&self) -> &FileTransferConfig {
        &self.file_transfer_config
    }

    /// Check if server file transfer is enabled
    pub fn is_server_file_transfer_enabled(&self) -> bool {
        self.file_transfer_config.allow_server_file_transfer
    }

    /// Check if server RE-VFS storage is enabled
    pub fn is_server_revfs_enabled(&self) -> bool {
        self.file_transfer_config.allow_server_revfs_storage
    }

    /// Health check: returns true if the kernel is operational
    /// Checks that NodeRemote is available and backend is accessible
    pub fn is_healthy(&self) -> bool {
        self.node_remote.read().is_some()
    }

    /// Get a new receiver for broadcast messages
    pub fn subscribe_broadcast(&self) -> broadcast::Receiver<BroadcastMessage> {
        self.broadcast_tx.subscribe()
    }

    /// Broadcast a response to all connected clients (except the excluded CID)
    pub fn broadcast(&self, response: WorkspaceProtocolResponse, exclude_cid: Option<u64>) {
        let msg = BroadcastMessage {
            response,
            exclude_cid,
        };
        if let Err(e) = self.broadcast_tx.send(msg) {
            // Only log when there are active receivers (0 receivers at startup is expected)
            if self.broadcast_tx.receiver_count() > 0 {
                warn!(target: "citadel", "Failed to broadcast workspace update: {}", e);
            }
        }
    }

    /// Create a kernel with admin user for testing
    pub async fn with_workspace_master_password(
        admin_password: &str,
    ) -> Result<Self, NetworkError> {
        Self::with_workspace_master_password_and_structure_and_file_transfer(
            admin_password,
            None,
            None,
        )
        .await
    }

    /// Create a kernel with admin user and optional workspace structure config
    pub async fn with_workspace_master_password_and_structure(
        admin_password: &str,
        workspace_structure: Option<(WorkspaceStructureConfig, Option<PathBuf>)>,
    ) -> Result<Self, NetworkError> {
        Self::with_workspace_master_password_and_structure_and_file_transfer(
            admin_password,
            workspace_structure,
            None,
        )
        .await
    }

    /// Create a kernel with admin user, workspace structure, and file transfer config
    pub async fn with_workspace_master_password_and_structure_and_file_transfer(
        admin_password: &str,
        workspace_structure: Option<(WorkspaceStructureConfig, Option<PathBuf>)>,
        file_transfer_config: Option<FileTransferConfig>,
    ) -> Result<Self, NetworkError> {
        info!(target: "citadel", "Creating AsyncWorkspaceServerKernel with admin user");

        let mut kernel = Self::with_file_transfer_config(None, file_transfer_config);

        // Log file transfer config
        info!(
            target: "citadel",
            "File transfer config: allow_server_file_transfer={}, allow_server_revfs_storage={}, max_size={}MB, quota={}MB",
            kernel.file_transfer_config.allow_server_file_transfer,
            kernel.file_transfer_config.allow_server_revfs_storage,
            kernel.file_transfer_config.max_file_transfer_size_mb,
            kernel.file_transfer_config.revfs_storage_quota_mb,
        );

        // Store the workspace password for later use in on_start
        kernel.workspace_password = Some(admin_password.to_string());
        kernel.workspace_structure = workspace_structure;

        // NOTE: Backend initialization (init() / migrate_if_needed()) is deliberately
        // deferred to on_start(). At this point in the constructor, NodeRemote is not
        // yet set, so the BackendTransactionManager would run against its in-memory
        // test_storage rather than the real backend - meaning the migration sentinel
        // would be written to the wrong place and real migration logic would silently
        // no-op on every restart. See on_start() below for the real init call.
        info!(target: "citadel", "Deferring backend init and admin injection until NodeRemote is available");

        Ok(kernel)
    }

    /// Set the NodeRemote instance
    pub fn set_node_remote(&self, node_remote: NodeRemote<R>) {
        info!(target: "citadel", "Setting NodeRemote in kernel and domain operations");
        *self.node_remote.write() = Some(node_remote.clone());
        self.domain_operations
            .backend_tx_manager
            .set_node_remote(node_remote);
    }

    /// Initialize the root workspace. Note that this does NOT create any admin user.
    /// The first real user to provide the master password via UpdateWorkspace becomes the admin/owner.
    pub async fn inject_admin_user(
        &self,
        workspace_master_password: &str,
    ) -> Result<(), NetworkError> {
        info!(target: "citadel", "Initializing root workspace (no pre-created admin user)");

        // Pre-populate the master password BEFORE any workspace checks
        // This ensures first-time initialization via CreateWorkspace can validate the password
        if !workspace_master_password.is_empty() {
            info!(target: "citadel", "Pre-populating master password for root workspace");
            self.domain_operations
                .backend_tx_manager
                .set_workspace_password(crate::WORKSPACE_ROOT_ID, workspace_master_password)
                .await?;
        }

        // Check if root workspace exists
        let workspace_exists = self.get_domain(crate::WORKSPACE_ROOT_ID).await?.is_some();

        if !workspace_exists {
            info!(target: "citadel", "Creating root workspace with no owner (first user with master password becomes admin)");

            // Debug: Check current storage mode
            if self.domain_operations.backend_tx_manager.is_test_mode() {
                warn!(target: "citadel", "Creating workspace in test storage mode!");
            } else {
                info!(target: "citadel", "Creating workspace in backend storage mode");
            }

            // Create root workspace object with no owner - first user with master password claims it
            let root_workspace_obj = citadel_workspace_types::structs::Workspace {
                id: crate::WORKSPACE_ROOT_ID.to_string(),
                name: "Root Workspace".to_string(),
                description: "The main workspace for this instance.".to_string(),
                owner_id: UNASSIGNED_OWNER.to_string(),
                members: vec![],
                offices: vec![],
                metadata: vec![],
            };

            // Create domain wrapper for the workspace
            let root_domain_enum_variant = citadel_workspace_types::structs::Domain::Workspace {
                workspace: root_workspace_obj.clone(),
            };

            // Insert both workspace and domain
            self.domain_operations
                .backend_tx_manager
                .insert_workspace(crate::WORKSPACE_ROOT_ID.to_string(), root_workspace_obj)
                .await?;

            self.domain_operations
                .backend_tx_manager
                .insert_domain(
                    crate::WORKSPACE_ROOT_ID.to_string(),
                    root_domain_enum_variant,
                )
                .await?;

            info!(target: "citadel", "Setting workspace password for root workspace");
            self.domain_operations
                .backend_tx_manager
                .set_workspace_password(crate::WORKSPACE_ROOT_ID, workspace_master_password)
                .await?;

            info!(target: "citadel", "Root workspace created successfully (awaiting first admin)");
        }

        Ok(())
    }

    /// Get a reference to the async domain operations
    pub fn domain_ops(&self) -> &AsyncDomainServerOperations<R> {
        &self.domain_operations
    }

    /// Get user from domain operations
    pub async fn get_user(
        &self,
        user_id: &str,
    ) -> Result<Option<citadel_workspace_types::structs::User>, NetworkError> {
        self.domain_operations
            .backend_tx_manager
            .get_user(user_id)
            .await
    }

    /// Get domain from domain operations
    pub async fn get_domain(
        &self,
        domain_id: &str,
    ) -> Result<Option<citadel_workspace_types::structs::Domain>, NetworkError> {
        self.domain_operations
            .backend_tx_manager
            .get_domain(domain_id)
            .await
    }

    /// Get the content base path if available
    pub fn get_content_base_path(&self) -> Option<PathBuf> {
        self.workspace_structure
            .as_ref()
            .and_then(|(_, path)| path.clone())
    }

    /// Persist node MDX content to file
    ///
    /// Writes the content to `{content_base_path}/{node_name}/CONTENT.md`.
    /// `node_name` is rejected if it would escape the content base
    /// directory — see `validate_content_segment`.
    pub async fn persist_node_content(
        &self,
        node_name: &str,
        mdx_content: &str,
    ) -> Result<(), NetworkError> {
        let Some(base_path) = self.get_content_base_path() else {
            return Ok(());
        };
        validate_content_segment(node_name)?;

        let content_path = base_path.join(node_name).join("CONTENT.md");
        info!(target: "citadel", "[ASYNC_KERNEL] Persisting node content to {:?}", content_path);

        // Ensure parent directory exists
        if let Some(parent) = content_path.parent() {
            tokio::fs::create_dir_all(parent).await.map_err(|e| {
                NetworkError::msg(format!("Failed to create directory {:?}: {}", parent, e))
            })?;
        }

        tokio::fs::write(&content_path, mdx_content)
            .await
            .map_err(|e| {
                NetworkError::msg(format!(
                    "Failed to persist node content to {:?}: {}",
                    content_path, e
                ))
            })
    }

    /// Persist office MDX content to file
    ///
    /// Writes the content to `{content_base_path}/{office_name}/CONTENT.md`.
    /// `office_name` is sanitised via `validate_content_segment`.
    pub async fn persist_office_content(
        &self,
        office_name: &str,
        mdx_content: &str,
    ) -> Result<(), NetworkError> {
        let Some(base_path) = self.get_content_base_path() else {
            // No content base path configured, skip file persistence
            return Ok(());
        };
        validate_content_segment(office_name)?;

        let office_content_path = base_path.join(office_name).join("CONTENT.md");
        info!(target: "citadel", "[ASYNC_KERNEL] Persisting office content to {:?}", office_content_path);

        tokio::fs::write(&office_content_path, mdx_content)
            .await
            .map_err(|e| {
                NetworkError::msg(format!(
                    "Failed to persist office content to {:?}: {}",
                    office_content_path, e
                ))
            })
    }

    /// Persist room MDX content to file
    ///
    /// Writes the content to `{content_base_path}/{office_name}/{room_name}/CONTENT.md`.
    /// Both `office_name` and `room_name` are sanitised via
    /// `validate_content_segment`.
    pub async fn persist_room_content(
        &self,
        office_name: &str,
        room_name: &str,
        mdx_content: &str,
    ) -> Result<(), NetworkError> {
        let Some(base_path) = self.get_content_base_path() else {
            // No content base path configured, skip file persistence
            return Ok(());
        };
        validate_content_segment(office_name)?;
        validate_content_segment(room_name)?;

        let room_content_path = base_path
            .join(office_name)
            .join(room_name)
            .join("CONTENT.md");
        info!(target: "citadel", "[ASYNC_KERNEL] Persisting room content to {:?}", room_content_path);

        tokio::fs::write(&room_content_path, mdx_content)
            .await
            .map_err(|e| {
                NetworkError::msg(format!(
                    "Failed to persist room content to {:?}: {}",
                    room_content_path, e
                ))
            })
    }

    /// Initialize workspace structure from configuration
    ///
    /// Creates offices and rooms as defined in the WorkspaceStructureConfig.
    /// Each office/room with chat_enabled=true gets a UUID for its chat channel.
    pub async fn initialize_workspace_structure(
        &self,
        config: &WorkspaceStructureConfig,
        base_path: Option<&std::path::Path>,
    ) -> Result<(), NetworkError> {
        use citadel_workspace_types::structs::{DomainNode, NodeEntityType};
        use uuid::Uuid;

        info!(
            target: "citadel",
            "Initializing workspace structure: {} with {} offices",
            config.name,
            config.offices.len()
        );

        // Validate default office configuration
        let default_count = config.offices.iter().filter(|o| o.is_default).count();
        if default_count > 1 {
            return Err(NetworkError::msg(format!(
                "Multiple default offices found ({}). Only one office can be marked as default.",
                default_count
            )));
        }
        // If no default is set, the first office will be the default
        let first_office_is_default = default_count == 0;

        // Get the current tree nodes to add office/room nodes
        let mut nodes = self
            .domain_operations
            .backend_tx_manager
            .get_all_nodes()
            .await?;
        let current_time = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system clock before unix epoch")
            .as_secs();

        // Derive entity type names from the schema (SSOT) instead of hardcoding
        use citadel_workspace_types::structs::TreeSchema;
        let schema = TreeSchema::default();
        let root_child_types = schema.root_child_types();
        let office_entity_type = root_child_types
            .first()
            .expect("schema must define at least one root child type")
            .to_string();
        let office_child_types = schema.get_allowed_children(&office_entity_type);
        let room_entity_type = office_child_types
            .first()
            .cloned()
            .expect("schema must define at least one child type for office-level nodes");

        for (idx, office_config) in config.offices.iter().enumerate() {
            // Determine if this office should be the default
            let is_default = if first_office_is_default {
                idx == 0 // First office becomes default if none specified
            } else {
                office_config.is_default
            };
            // Generate UUID for the office
            let office_id = Uuid::new_v4().to_string();

            // Load markdown content if path is specified
            let mdx_content = if let Some(md_path) = &office_config.markdown_file {
                let full_path = if let Some(base) = base_path {
                    base.join(md_path)
                } else {
                    std::path::PathBuf::from(md_path)
                };

                match std::fs::read_to_string(&full_path) {
                    Ok(content) => {
                        info!(
                            target: "citadel",
                            "Loaded markdown for office '{}': {:?}",
                            office_config.name, full_path
                        );
                        content
                    }
                    Err(e) => {
                        warn!(
                            target: "citadel",
                            "Failed to load markdown for office '{}': {}",
                            office_config.name, e
                        );
                        String::new()
                    }
                }
            } else {
                String::new()
            };

            // Assign chat channel ID if chat is enabled
            let chat_channel_id = if office_config.chat_enabled {
                Some(Uuid::new_v4().to_string())
            } else {
                None
            };

            // Create office DomainNode at depth 1
            let office_node = DomainNode {
                id: office_id.clone(),
                parent_id: Some(crate::WORKSPACE_ROOT_ID.to_string()),
                entity_type: NodeEntityType::Child(office_entity_type.clone()),
                depth: 1,
                name: office_config.name.clone(),
                description: office_config.description.clone().unwrap_or_default(),
                owner_id: UNASSIGNED_OWNER.to_string(),
                members: vec![],
                children: Vec::new(),
                mdx_content,
                rules: office_config.rules.clone(),
                chat_enabled: office_config.chat_enabled,
                chat_channel_id,
                default_permissions: office_config.default_permissions.clone(),
                metadata: Vec::new(),
                allowed_child_types: Some(schema.get_allowed_children(&office_entity_type)),
                is_default,
                created_at: current_time,
                updated_at: current_time,
            };

            info!(
                target: "citadel",
                "Creating office node '{}' (id: {}, chat_enabled: {}, is_default: {})",
                office_config.name, office_id, office_config.chat_enabled, is_default
            );

            // Add office to workspace's children
            if let Some(workspace_node) = nodes.get_mut(crate::WORKSPACE_ROOT_ID) {
                workspace_node.children.push(office_id.clone());
            }

            // Create room nodes within this office, accumulating children on office_node
            let mut office_node = office_node;
            for room_config in &office_config.rooms {
                let room_id = Uuid::new_v4().to_string();

                // Load room markdown content
                let room_mdx_content = if let Some(md_path) = &room_config.markdown_file {
                    let full_path = if let Some(base) = base_path {
                        base.join(md_path)
                    } else {
                        std::path::PathBuf::from(md_path)
                    };

                    match std::fs::read_to_string(&full_path) {
                        Ok(content) => {
                            info!(
                                target: "citadel",
                                "Loaded markdown for room '{}': {:?}",
                                room_config.name, full_path
                            );
                            content
                        }
                        Err(e) => {
                            warn!(
                                target: "citadel",
                                "Failed to load markdown for room '{}': {}",
                                room_config.name, e
                            );
                            String::new()
                        }
                    }
                } else {
                    String::new()
                };

                // Assign chat channel ID if chat is enabled
                let room_chat_channel_id = if room_config.chat_enabled {
                    Some(Uuid::new_v4().to_string())
                } else {
                    None
                };

                // Create room DomainNode at depth 2
                let room_node = DomainNode {
                    id: room_id.clone(),
                    parent_id: Some(office_id.clone()),
                    entity_type: NodeEntityType::Child(room_entity_type.clone()),
                    depth: 2,
                    name: room_config.name.clone(),
                    description: room_config.description.clone().unwrap_or_default(),
                    owner_id: UNASSIGNED_OWNER.to_string(),
                    members: vec![],
                    children: Vec::new(),
                    mdx_content: room_mdx_content,
                    rules: room_config.rules.clone(),
                    chat_enabled: room_config.chat_enabled,
                    chat_channel_id: room_chat_channel_id,
                    default_permissions: room_config.default_permissions.clone(),
                    metadata: Vec::new(),
                    allowed_child_types: Some(schema.get_allowed_children(&room_entity_type)),
                    is_default: false,
                    created_at: current_time,
                    updated_at: current_time,
                };

                info!(
                    target: "citadel",
                    "Creating room node '{}' in office '{}' (id: {}, chat_enabled: {})",
                    room_config.name, office_config.name, room_id, room_config.chat_enabled
                );

                // Accumulate room as child of office
                office_node.children.push(room_id.clone());

                // Insert room node
                nodes.insert(room_id, room_node);
            }

            // Insert office node with accumulated children
            nodes.insert(office_id, office_node);
        }

        // Save all nodes back to storage
        self.domain_operations
            .backend_tx_manager
            .save_nodes(&nodes)
            .await?;

        info!(target: "citadel", "Workspace structure initialization complete");
        Ok(())
    }
}

// Implement NetKernel for AsyncWorkspaceServerKernel
#[async_trait::async_trait]
impl<R: Ratchet + Send + Sync + 'static> citadel_sdk::prelude::NetKernel<R>
    for AsyncWorkspaceServerKernel<R>
{
    fn load_remote(&mut self, server_remote: NodeRemote<R>) -> Result<(), NetworkError> {
        info!(target: "citadel", "Loading NodeRemote into AsyncWorkspaceServerKernel");

        // Set in both places
        *self.node_remote.write() = Some(server_remote.clone());
        self.domain_operations
            .backend_tx_manager
            .set_node_remote(server_remote);

        Ok(())
    }

    async fn on_start(&self) -> Result<(), NetworkError> {
        info!(target: "citadel", "NetKernel started");

        if self.domain_operations.backend_tx_manager.is_test_mode() {
            error!(target: "citadel", "NodeRemote not set after node start!");
        } else {
            // Initialize backend (runs legacy-key migration once against the real
            // backend). Runs unconditionally in production so migrations fire
            // even in configurations that didn't set `workspace_password`.
            // Safe to call every startup: `migrate_if_needed` checks the
            // persistent KEY_MIGRATION_DONE sentinel and is a no-op once
            // migration has run.
            info!(target: "citadel", "NodeRemote is available, running backend init");
            self.domain_operations.backend_tx_manager.init().await?;

            // Re-run admin injection now that NodeRemote is available
            if let Some(workspace_password) = &self.workspace_password {
                info!(target: "citadel", "Injecting admin and workspace");
                self.inject_admin_user(workspace_password).await?;

                // Initialize workspace structure from config if provided
                if let Some((structure, base_path)) = &self.workspace_structure {
                    info!(target: "citadel", "Initializing workspace structure from config");
                    self.initialize_workspace_structure(structure, base_path.as_deref())
                        .await?;
                }
            }
        }

        // Schema version check and migration infrastructure
        if !self.domain_operations.backend_tx_manager.is_test_mode() {
            let backend = &self.domain_operations.backend_tx_manager;
            match backend.get_schema_version().await? {
                None => {
                    // Fresh database or pre-versioning installation: stamp with current version
                    info!(
                        target: "citadel",
                        "No schema version found, initializing to v{}",
                        CURRENT_SCHEMA_VERSION
                    );
                    backend.set_schema_version(CURRENT_SCHEMA_VERSION).await?;
                }
                Some(version) if version < CURRENT_SCHEMA_VERSION => {
                    info!(
                        target: "citadel",
                        "Schema migration required: v{} -> v{}",
                        version,
                        CURRENT_SCHEMA_VERSION
                    );
                    // Future migrations go here, applied sequentially:
                    // if version < 2 { migrate_v1_to_v2().await?; }
                    // if version < 3 { migrate_v2_to_v3().await?; }
                    // ...
                    backend.set_schema_version(CURRENT_SCHEMA_VERSION).await?;
                    info!(
                        target: "citadel",
                        "Schema migration complete, now at v{}",
                        CURRENT_SCHEMA_VERSION
                    );
                }
                Some(version) if version > CURRENT_SCHEMA_VERSION => {
                    // Refuse to start: a newer-than-expected schema means
                    // either we're booting an older binary against a
                    // forward-migrated store, or the backend has been
                    // tampered with. Proceeding could silently corrupt
                    // data — newer migrations may have rewritten keys
                    // this binary doesn't know how to read. Operators
                    // who legitimately downgrade can set
                    // `WORKSPACE_ALLOW_SCHEMA_DOWNGRADE=1` to bypass.
                    if std::env::var("WORKSPACE_ALLOW_SCHEMA_DOWNGRADE")
                        .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
                        .unwrap_or(false)
                    {
                        warn!(
                            target: "citadel",
                            "Backend schema version (v{}) is newer than expected (v{}); \
                             WORKSPACE_ALLOW_SCHEMA_DOWNGRADE is set, proceeding anyway. \
                             Data corruption is possible if the storage format changed.",
                            version,
                            CURRENT_SCHEMA_VERSION
                        );
                    } else {
                        return Err(NetworkError::msg(format!(
                            "Backend schema version (v{}) is newer than this binary expects (v{}). \
                             Refusing to start to prevent silent data corruption. \
                             To override (e.g. an intentional downgrade), set \
                             WORKSPACE_ALLOW_SCHEMA_DOWNGRADE=1.",
                            version, CURRENT_SCHEMA_VERSION,
                        )));
                    }
                }
                Some(version) => {
                    info!(
                        target: "citadel",
                        "Schema version v{} is current, no migration needed",
                        version
                    );
                }
            }
        }

        Ok(())
    }

    async fn on_node_event_received(
        &self,
        event: citadel_sdk::prelude::NodeResult<R>,
    ) -> Result<(), NetworkError> {
        use crate::WorkspaceProtocolResponse;
        use citadel_logging::{debug, error, info, warn};
        use citadel_workspace_types::WorkspaceProtocolPayload;
        use tokio_stream::StreamExt;

        debug!(target: "citadel", "[ASYNC_KERNEL] NetKernel received event: {event:?}");

        match event {
            NodeResult::ConnectSuccess(connect_success) => {
                let this = self.clone();
                tokio::spawn(async move {
                    let _cid = connect_success.session_cid;
                    let user_cid = connect_success.channel.get_session_cid();

                    // Get account manager from node remote
                    let account_manager = {
                        let node_remote_guard = this.node_remote.read();
                        match node_remote_guard.as_ref() {
                            Some(remote) => remote.account_manager().clone(),
                            None => {
                                error!(target: "citadel", "[ASYNC_KERNEL] NodeRemote not available during ConnectSuccess for CID {}", connect_success.session_cid);
                                return Err(NetworkError::generic(
                                    "NodeRemote not available".to_string(),
                                ));
                            }
                        }
                    };

                    // Get user ID from connection
                    let user_id = account_manager
                        .get_username_by_cid(connect_success.session_cid)
                        .await?
                        .ok_or_else(|| {
                            NetworkError::generic(format!(
                                "User not found for CID {}",
                                connect_success.session_cid
                            ))
                        })?;

                    info!(target: "citadel", "[ASYNC_KERNEL] User {} connected with cid {} ({})", user_id, connect_success.session_cid, user_cid);

                    // Check if user is already in workspace domain
                    debug!(target: "citadel", "Checking for root workspace...");

                    // Debug: Check current storage mode
                    if this.domain_operations.backend_tx_manager.is_test_mode() {
                        warn!(target: "citadel", "Checking workspace in test storage mode!");
                    } else {
                        debug!(target: "citadel", "Checking workspace in backend storage mode");
                    }

                    let workspace = match this.get_domain(crate::WORKSPACE_ROOT_ID).await? {
                        Some(domain) => {
                            debug!(target: "citadel", "Root workspace found");
                            domain
                        }
                        None => {
                            error!(target: "citadel", "Root workspace not found for user {}", user_id);

                            // Debug: Let's check what domains exist
                            let all_domains = this
                                .domain_operations
                                .backend_tx_manager
                                .get_all_domains()
                                .await?;
                            debug!(
                                target: "citadel",
                                "Available domains: {:?}",
                                all_domains.keys().collect::<Vec<_>>()
                            );

                            return Err(NetworkError::generic(
                                "Root workspace not found".to_string(),
                            ));
                        }
                    };

                    // Add user to workspace domain if they aren't already a member
                    if !workspace.members().contains(&user_id) {
                        info!(target: "citadel", "[ASYNC_KERNEL] Adding user {} to workspace domain", user_id);

                        // First ensure the user exists in the system
                        let user_exists = this.get_user(&user_id).await?.is_some();
                        if !user_exists {
                            // Create a basic user with Member role
                            use citadel_workspace_types::structs::{User, UserRole};
                            let user = User::new(
                                user_id.clone(),
                                user_id.clone(), // Use user_id as display name initially
                                UserRole::Member,
                            );
                            this.domain_operations
                                .backend_tx_manager
                                .insert_user(user_id.clone(), user)
                                .await?;
                        }

                        // Add user directly to workspace members (no admin required for initial connection)
                        // This bypasses the permission check since authenticated users should be allowed
                        let mut ws = this
                            .domain_operations
                            .backend_tx_manager
                            .get_workspace(crate::WORKSPACE_ROOT_ID)
                            .await?
                            .ok_or_else(|| NetworkError::msg("Root workspace not found"))?;

                        if !ws.members.contains(&user_id) {
                            ws.members.push(user_id.clone());
                            this.domain_operations
                                .backend_tx_manager
                                .insert_workspace(crate::WORKSPACE_ROOT_ID.to_string(), ws.clone())
                                .await?;

                            // Update domain as well
                            let ws_domain = citadel_workspace_types::structs::Domain::Workspace {
                                workspace: ws,
                            };
                            this.domain_operations
                                .backend_tx_manager
                                .insert_domain(crate::WORKSPACE_ROOT_ID.to_string(), ws_domain)
                                .await?;
                        }

                        info!(target: "citadel", "[ASYNC_KERNEL] User {} added to workspace domain", user_id);
                    }

                    let (mut tx, mut rx) = connect_success.channel.split();
                    let current_cid = user_cid;

                    // Subscribe to broadcast channel for this connection
                    let mut broadcast_rx = this.subscribe_broadcast();

                    // Per-CID token-bucket limiter shared across the
                    // kernel. Multiple concurrent connections owned by
                    // the same CID share one bucket - the previous
                    // per-connection variables let a single user open N
                    // connections to multiply their effective limit.
                    let rate_limiter = this.rate_limiter.clone();

                    // Main message processing loop for this connection
                    // Uses select! to handle both incoming messages and broadcasts
                    loop {
                        tokio::select! {
                            // Handle incoming messages from client
                            msg_opt = rx.next() => {
                                let Some(msg) = msg_opt else {
                                    // Connection closed
                                    break;
                                };

                                if !rate_limiter.try_consume(current_cid, std::time::Instant::now()) {
                                    warn!(target: "citadel", "[ASYNC_KERNEL] Rate limit exceeded for CID {}", current_cid);
                                    let response = WorkspaceProtocolPayload::Response(Box::new(
                                        WorkspaceProtocolResponse::Error("Rate limit exceeded. Please slow down.".to_string())
                                    ));
                                    if let Ok(serialized) = serde_json::to_vec(&response) {
                                        let _ = tx.send(serialized).await;
                                    }
                                    continue;
                                }

                                match serde_json::from_slice::<WorkspaceProtocolPayload>(msg.as_ref()) {
                                    Ok(command_payload) => {
                                        if let WorkspaceProtocolPayload::Request(request) = command_payload
                                        {
                                            // Process command using async command processor with user context and CID
                                            use crate::kernel::command_processor::async_process_command::process_command_with_user_and_cid;
                                            let response =
                                                process_command_with_user_and_cid(&this, &request, &user_id, Some(current_cid))
                                                    .await
                                                    .unwrap_or_else(|e| {
                                                        WorkspaceProtocolResponse::Error(e.to_string())
                                                    });

                                            let response_wrapped =
                                                WorkspaceProtocolPayload::Response(Box::new(response));
                                            match serde_json::to_vec(&response_wrapped) {
                                                Ok(serialized_response) => {
                                                    if let Err(e) = tx.send(serialized_response).await {
                                                        error!(target: "citadel", "[ASYNC_KERNEL] Failed to send response: {:?}", e);
                                                        break;
                                                    }
                                                }
                                                Err(e) => {
                                                    error!(target: "citadel", "[ASYNC_KERNEL] Failed to serialize response with serde_json: {:?}", e);
                                                }
                                            }
                                        } else {
                                            warn!(target: "citadel", "[ASYNC_KERNEL] Server received a WorkspaceProtocolPayload::Response when it expected a Request: {:?}", command_payload);
                                        }
                                    }
                                    Err(e) => {
                                        error!(target: "citadel", "[ASYNC_KERNEL] Failed to deserialize command with serde_json: {:?}. Message (first 50 bytes): {:?}", e, msg.as_ref().iter().take(50).collect::<Vec<_>>());
                                        let error_response = WorkspaceProtocolResponse::Error(format!(
                                            "Invalid command. Failed serde_json deserialization: {}",
                                            e
                                        ));
                                        let response_wrapped =
                                            WorkspaceProtocolPayload::Response(Box::new(error_response));
                                        match serde_json::to_vec(&response_wrapped) {
                                            Ok(serialized_error_response) => {
                                                if let Err(send_err) =
                                                    tx.send(serialized_error_response).await
                                                {
                                                    error!(target: "citadel", "[ASYNC_KERNEL] Failed to send deserialization error response: {:?}", send_err);
                                                    break;
                                                }
                                            }
                                            Err(serialize_err) => {
                                                error!(target: "citadel", "[ASYNC_KERNEL] Failed to serialize deserialization error response with serde_json: {:?}", serialize_err);
                                            }
                                        }
                                    }
                                }
                            }

                            // Handle broadcast messages from other connections
                            broadcast_result = broadcast_rx.recv() => {
                                match broadcast_result {
                                    Ok(broadcast_msg) => {
                                        // Skip if this connection is excluded (the originator)
                                        if broadcast_msg.exclude_cid == Some(current_cid) {
                                            continue;
                                        }

                                        // Forward the broadcast to this client
                                        let response_wrapped =
                                            WorkspaceProtocolPayload::Response(Box::new(broadcast_msg.response));
                                        match serde_json::to_vec(&response_wrapped) {
                                            Ok(serialized_response) => {
                                                if let Err(e) = tx.send(serialized_response).await {
                                                    error!(target: "citadel", "[ASYNC_KERNEL] Failed to send broadcast: {:?}", e);
                                                    break;
                                                }
                                            }
                                            Err(e) => {
                                                error!(target: "citadel", "[ASYNC_KERNEL] Failed to serialize broadcast with serde_json: {:?}", e);
                                            }
                                        }
                                    }
                                    Err(broadcast::error::RecvError::Lagged(n)) => {
                                        warn!(target: "citadel", "[ASYNC_KERNEL] Broadcast receiver lagged by {} messages", n);
                                    }
                                    Err(broadcast::error::RecvError::Closed) => {
                                        // Broadcast channel closed, shouldn't happen during normal operation
                                        break;
                                    }
                                }
                            }
                        }
                    }

                    info!(target: "citadel", "[ASYNC_KERNEL] Connection closed for user {}", user_id);
                    Ok::<(), NetworkError>(())
                });
            }

            NodeResult::Disconnect { .. } => {
                debug!(target: "citadel", "[ASYNC_KERNEL] Client disconnected");
            }

            NodeResult::ObjectTransferHandle(mut object_transfer_handle) => {
                // Handle file transfer events for server storage (RE-VFS)
                info!(target: "citadel", "[ASYNC_KERNEL] Received ObjectTransferHandle event");

                // Check if server file transfers are enabled
                let ft_config = self.file_transfer_config.clone();
                if !ft_config.allow_server_file_transfer {
                    warn!(target: "citadel", "[ASYNC_KERNEL] Server file transfers are disabled, declining transfer");
                    if let Err(e) = object_transfer_handle.handle.decline() {
                        error!(target: "citadel", "[ASYNC_KERNEL] Failed to decline file transfer: {:?}", e);
                    }
                    return Ok(());
                }

                tokio::spawn(async move {
                    use tokio_stream::StreamExt;

                    let mut handle = object_transfer_handle.handle;
                    let orientation = handle.orientation;

                    info!(target: "citadel", "[ASYNC_KERNEL] File transfer orientation: {:?}", orientation);

                    // Auto-accept incoming transfers for server storage
                    if let Err(e) = handle.accept() {
                        error!(target: "citadel", "[ASYNC_KERNEL] Failed to accept file transfer: {:?}", e);
                        return;
                    }

                    info!(target: "citadel", "[ASYNC_KERNEL] File transfer accepted, processing...");

                    // Process transfer status events
                    while let Some(status) = handle.next().await {
                        match status {
                            ObjectTransferStatus::ReceptionBeginning(file_path, transfer_type) => {
                                info!(target: "citadel", "[ASYNC_KERNEL] File transfer beginning: {:?}, type: {:?}", file_path, transfer_type);
                            }
                            ObjectTransferStatus::ReceptionTick(_cid, _rel_group_id, percent) => {
                                debug!(target: "citadel", "[ASYNC_KERNEL] File transfer progress: {}%", percent);
                            }
                            ObjectTransferStatus::ReceptionComplete => {
                                info!(target: "citadel", "[ASYNC_KERNEL] File transfer reception complete");
                            }
                            ObjectTransferStatus::TransferComplete => {
                                info!(target: "citadel", "[ASYNC_KERNEL] File transfer (send) complete");
                            }
                            ObjectTransferStatus::Fail(err) => {
                                error!(target: "citadel", "[ASYNC_KERNEL] File transfer failed: {}", err);
                            }
                            _ => {
                                debug!(target: "citadel", "[ASYNC_KERNEL] File transfer status: {:?}", status);
                            }
                        }
                    }

                    info!(target: "citadel", "[ASYNC_KERNEL] File transfer handle completed");
                });
            }

            evt => {
                debug!(target: "citadel", "[ASYNC_KERNEL] Unhandled event: {evt:?}");
            }
        }

        Ok(())
    }

    async fn on_stop(&mut self) -> Result<(), NetworkError> {
        info!(target: "citadel", "NetKernel stopping - broadcasting shutdown to connected clients");

        // Inform every connected client via the dedicated ServerShutdown
        // variant. Previously this used WorkspaceProtocolResponse::Error,
        // which caused UIs to render a red error toast on every planned
        // restart - misleading because graceful shutdown is a normal
        // operational event, not a failure.
        const DRAIN_SECONDS: u64 = 2;
        self.broadcast(
            WorkspaceProtocolResponse::ServerShutdown {
                message: "Server is shutting down for a planned restart.".to_string(),
                drain_seconds: DRAIN_SECONDS,
            },
            None,
        );

        // Allow brief drain period for in-flight requests
        info!(target: "citadel", "Allowing {DRAIN_SECONDS}s drain period for in-flight requests");
        tokio::time::sleep(std::time::Duration::from_secs(DRAIN_SECONDS)).await;

        info!(target: "citadel", "NetKernel stopped");
        Ok(())
    }
}

impl<R: Ratchet + Send + Sync + 'static> AsyncWorkspaceServerKernel<R> {
    /// Sets the NodeRemote after the node has been built
    ///
    /// This method provides a way to set the node remote after kernel initialization,
    /// which is useful when the remote is not available during construction.
    pub async fn set_node_remote_async(&self, node_remote: NodeRemote<R>) {
        info!(target: "citadel", "[ASYNC_KERNEL] Setting NodeRemote for AsyncWorkspaceServerKernel");
        *self.node_remote.write() = Some(node_remote.clone());
        self.domain_operations
            .backend_tx_manager
            .set_node_remote(node_remote);
        info!(target: "citadel", "[ASYNC_KERNEL] NodeRemote set for AsyncWorkspaceServerKernel");
    }
}

#[cfg(test)]
mod shutdown_tests {
    //! Tests for the graceful-shutdown broadcast path.
    //!
    //! The behaviour under test is `on_stop`: it must broadcast a
    //! `ServerShutdown` variant (NOT `Error`) to every subscriber so
    //! UIs can tell a planned restart apart from a real failure and
    //! render the appropriate UX (reconnect countdown vs red toast).
    use super::*;
    use citadel_sdk::prelude::{NetKernel, StackedRatchet};

    /// Drives `on_stop` against a fresh kernel and asserts the
    /// resulting broadcast is `ServerShutdown { .. }`.
    ///
    /// We start the broadcast subscriber in a background task and
    /// receive *before* awaiting `on_stop` to completion, so we don't
    /// have to pay the full real-time drain delay - the broadcast is
    /// emitted synchronously at the top of `on_stop`, before its sleep.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn on_stop_broadcasts_server_shutdown_not_error() {
        let mut kernel = AsyncWorkspaceServerKernel::<StackedRatchet>::new(None);
        let mut rx = kernel.subscribe_broadcast();

        let receive = tokio::spawn(async move {
            tokio::time::timeout(std::time::Duration::from_secs(5), rx.recv())
                .await
                .expect("broadcast must arrive before timeout")
                .expect("broadcast channel must not error")
        });

        // `on_stop` from the NetKernel trait. The broadcast is emitted
        // synchronously at the top of the function, then it sleeps for
        // a small drain window. The receiver task above will pick up
        // the broadcast immediately and complete before this returns.
        kernel.on_stop().await.expect("on_stop");

        let msg = receive.await.expect("subscriber task should complete");
        match msg.response {
            WorkspaceProtocolResponse::ServerShutdown { drain_seconds, message } => {
                assert!(drain_seconds >= 1, "drain_seconds should be > 0 ({drain_seconds})");
                assert!(
                    !message.is_empty(),
                    "message should be a human-readable description, got empty"
                );
            }
            other => panic!(
                "expected ServerShutdown, got {other:?}. Regression: a future change must \
                 NOT use Error here - it would render as a red error toast on every planned restart."
            ),
        }
        // exclude_cid is None: the shutdown signal must reach every
        // connected client, including the one that initiated the
        // restart (if any). A future change to set this to Some(_)
        // would silently drop the notification on certain clients.
        assert!(
            msg.exclude_cid.is_none(),
            "shutdown broadcast must not exclude any CID"
        );
    }
}

#[cfg(test)]
mod content_segment_tests {
    //! Boundary tests for `validate_content_segment`. The function is
    //! the only thing standing between user-supplied node names and
    //! `tokio::fs::write` underneath the content directory; if any of
    //! the rejection rules ever loosen, a malicious or malformed name
    //! could escape the content tree.
    use super::validate_content_segment;

    #[test]
    fn accepts_a_normal_name() {
        validate_content_segment("Engineering").expect("normal name must be accepted");
        validate_content_segment("Q4-Planning").expect("dashes are fine");
        validate_content_segment("Office 1").expect("spaces are fine");
        validate_content_segment("café").expect("non-ascii is fine");
    }

    #[test]
    fn rejects_empty() {
        assert!(validate_content_segment("").is_err());
    }

    #[test]
    fn rejects_traversal_sentinels() {
        assert!(validate_content_segment(".").is_err());
        assert!(validate_content_segment("..").is_err());
    }

    #[test]
    fn rejects_path_separators() {
        // `Path::join` interprets a leading slash as an absolute
        // root, which would let a malicious caller redirect the write
        // to /etc/anything; backslash is rejected too because `tokio::fs`
        // on Windows treats it as a separator.
        assert!(validate_content_segment("foo/bar").is_err());
        assert!(validate_content_segment("/etc/passwd").is_err());
        assert!(validate_content_segment("foo\\bar").is_err());
        assert!(validate_content_segment("\\\\server\\share").is_err());
    }

    #[test]
    fn rejects_traversal_via_relative_segments() {
        assert!(validate_content_segment("../../etc/evil").is_err());
        assert!(validate_content_segment("..\\..\\windows").is_err());
    }

    #[test]
    fn rejects_hidden_dot_prefixes() {
        // Blocks `.git`, `.ssh`, `.well-known`, etc. — these aren't
        // legitimate workspace names and a name like `.config` could
        // shadow operationally-sensitive directories if the content
        // root happened to be a user home directory.
        assert!(validate_content_segment(".git").is_err());
        assert!(validate_content_segment(".env").is_err());
        assert!(validate_content_segment(".hiddenfile").is_err());
    }

    #[test]
    fn rejects_nul_byte() {
        assert!(validate_content_segment("foo\0bar").is_err());
    }
}
