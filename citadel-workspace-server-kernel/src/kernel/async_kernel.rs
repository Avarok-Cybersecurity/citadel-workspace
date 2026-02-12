//! # Async Workspace Server Kernel
//!
//! This module provides the async version of WorkspaceServerKernel that uses
//! the BackendTransactionManager for all persistence operations.

use crate::config::{FileTransferConfig, WorkspaceStructureConfig};
use crate::handlers::domain::server_ops::async_domain_server_ops::AsyncDomainServerOperations;
use crate::kernel::transaction::BackendTransactionManager;
use crate::WorkspaceProtocolResponse;
use citadel_logging::{error, info, warn};
use citadel_sdk::prelude::{NetworkError, NodeRemote, NodeResult, ObjectTransferStatus, Ratchet};
use parking_lot::RwLock;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::broadcast;

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

        // Initialize the backend
        kernel.domain_operations.backend_tx_manager.init().await?;

        // Don't inject admin here - wait until on_start when NodeRemote is available
        info!(target: "citadel", "Deferring admin injection until NodeRemote is available");

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

    /// Persist office MDX content to file
    ///
    /// Writes the content to `{content_base_path}/{office_name}/CONTENT.md`
    pub async fn persist_office_content(
        &self,
        office_name: &str,
        mdx_content: &str,
    ) -> Result<(), NetworkError> {
        let Some(base_path) = self.get_content_base_path() else {
            // No content base path configured, skip file persistence
            return Ok(());
        };

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
    /// Writes the content to `{content_base_path}/{office_name}/{room_name}/CONTENT.md`
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

            // Create room nodes within this office
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

                // Add room to office's children (we'll update the office node before inserting)
                nodes
                    .entry(office_id.clone())
                    .and_modify(|n| n.children.push(room_id.clone()))
                    .or_insert_with(|| {
                        let mut new_office = office_node.clone();
                        new_office.children.push(room_id.clone());
                        new_office
                    });

                // Insert room node
                nodes.insert(room_id, room_node);
            }

            // Insert office node (either updated with children or fresh)
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

        // Re-run admin injection now that NodeRemote is available
        if self.domain_operations.backend_tx_manager.is_test_mode() {
            error!(target: "citadel", "NodeRemote not set after node start!");
        } else if let Some(workspace_password) = &self.workspace_password {
            info!(target: "citadel", "NodeRemote is available, injecting admin and workspace");
            // Inject admin now that we have backend storage
            self.inject_admin_user(workspace_password).await?;

            // Initialize workspace structure from config if provided
            if let Some((structure, base_path)) = &self.workspace_structure {
                info!(target: "citadel", "Initializing workspace structure from config");
                self.initialize_workspace_structure(structure, base_path.as_deref())
                    .await?;
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
                                return Err(NetworkError::Generic(
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
                            NetworkError::Generic(format!(
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

                            return Err(NetworkError::Generic(
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
        info!(target: "citadel", "NetKernel stopping");
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
