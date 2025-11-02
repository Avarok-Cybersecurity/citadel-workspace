//! # Async Workspace Server Kernel
//!
//! This module provides the async version of WorkspaceServerKernel that uses
//! the BackendTransactionManager for all persistence operations.

use crate::handlers::domain::server_ops::async_domain_server_ops::AsyncDomainServerOperations;
use crate::kernel::transaction::BackendTransactionManager;
use citadel_logging::info;
use citadel_sdk::prelude::{NetworkError, NodeRemote, NodeResult, Ratchet};
use citadel_workspace_types::structs::UserRole;
use parking_lot::RwLock;
use std::sync::Arc;

/// Async version of WorkspaceServerKernel that uses backend persistence
pub struct AsyncWorkspaceServerKernel<R: Ratchet> {
    /// Network node remote for handling connections
    pub node_remote: Arc<RwLock<Option<NodeRemote<R>>>>,
    /// Async domain operations handler
    pub domain_operations: AsyncDomainServerOperations<R>,
    /// Workspace password (stored temporarily for on_start)
    workspace_password: Option<String>,
}

// The default. This is not a protocol account, just an account that has the ability to run
// workspace-level commands via just the workspace master password
pub const ADMIN_ROOT_USER_ID: &str = "__admin_user";

impl<R: Ratchet> Clone for AsyncWorkspaceServerKernel<R> {
    fn clone(&self) -> Self {
        Self {
            node_remote: self.node_remote.clone(),
            domain_operations: self.domain_operations.clone(),
            workspace_password: self.workspace_password.clone(),
        }
    }
}

impl<R: Ratchet + Send + Sync + 'static> AsyncWorkspaceServerKernel<R> {
    /// Create a new AsyncWorkspaceServerKernel with backend persistence
    pub fn new(node_remote: Option<NodeRemote<R>>) -> Self {
        println!("[ASYNC_KERNEL] Creating AsyncWorkspaceServerKernel with backend persistence");

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

        Self {
            node_remote: node_remote_arc,
            domain_operations,
            workspace_password: None,
        }
    }

    /// Create a kernel with admin user for testing
    pub async fn with_workspace_master_password(
        admin_password: &str,
    ) -> Result<Self, NetworkError> {
        println!("[ASYNC_KERNEL] Creating AsyncWorkspaceServerKernel with admin user");

        let mut kernel = Self::new(None);

        // Store the workspace password for later use in on_start
        kernel.workspace_password = Some(admin_password.to_string());

        // Initialize the backend
        kernel.domain_operations.backend_tx_manager.init().await?;

        // Don't inject admin here - wait until on_start when NodeRemote is available
        println!("[ASYNC_KERNEL] Deferring admin injection until NodeRemote is available");

        Ok(kernel)
    }

    /// Set the NodeRemote instance
    pub fn set_node_remote(&self, node_remote: NodeRemote<R>) {
        println!("[ASYNC_KERNEL] Setting NodeRemote in kernel and domain operations");
        *self.node_remote.write() = Some(node_remote.clone());
        self.domain_operations
            .backend_tx_manager
            .set_node_remote(node_remote);
    }

    /// Inject admin user (async version). Note that this is NOT the protocol user.
    /// In fact, any protocol user can take the admin role provided they have the workspace
    /// master password
    pub async fn inject_admin_user(
        &self,
        workspace_master_password: &str,
    ) -> Result<(), NetworkError> {
        use citadel_workspace_types::structs::{
            MetadataValue as InternalMetadataValue, Permission, User,
        };
        use std::collections::HashSet;

        println!(
            "[ASYNC_KERNEL] Injecting admin user: {}",
            ADMIN_ROOT_USER_ID
        );

        // Check if user already exists
        let user_exists = self.get_user(ADMIN_ROOT_USER_ID).await?.is_some();

        if !user_exists {
            let mut user = User::new(
                ADMIN_ROOT_USER_ID.to_string(),
                ADMIN_ROOT_USER_ID.to_string(),
                UserRole::Admin,
            );

            // Add primary_workspace_id to admin user's metadata
            user.metadata.insert(
                "primary_workspace_id".to_string(),
                InternalMetadataValue::String(crate::WORKSPACE_ROOT_ID.to_string()),
            );

            // Grant the admin user all permissions on the root workspace
            let mut root_permissions = HashSet::new();
            root_permissions.insert(Permission::All);
            user.permissions
                .insert(crate::WORKSPACE_ROOT_ID.to_string(), root_permissions);

            // Insert user using backend
            self.domain_operations
                .backend_tx_manager
                .insert_user(ADMIN_ROOT_USER_ID.to_string(), user)
                .await?;
        }

        // Check if root workspace exists
        let workspace_exists = self.get_domain(crate::WORKSPACE_ROOT_ID).await?.is_some();

        if !workspace_exists {
            println!("[ASYNC_KERNEL] Creating root workspace");

            // Debug: Check current storage mode
            if self.domain_operations.backend_tx_manager.is_test_mode() {
                println!("[ASYNC_KERNEL] WARNING: Creating workspace in test storage mode!");
            } else {
                println!("[ASYNC_KERNEL] Creating workspace in backend storage mode");
            }

            // Create root workspace object
            let root_workspace_obj = citadel_workspace_types::structs::Workspace {
                id: crate::WORKSPACE_ROOT_ID.to_string(),
                name: "Root Workspace".to_string(),
                description: "The main workspace for this instance.".to_string(),
                owner_id: ADMIN_ROOT_USER_ID.to_string(),
                members: vec![ADMIN_ROOT_USER_ID.to_string()],
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

            println!("[ASYNC_KERNEL] Setting workspace password for root workspace");
            self.domain_operations
                .backend_tx_manager
                .set_workspace_password(crate::WORKSPACE_ROOT_ID, workspace_master_password)
                .await?;

            println!("[ASYNC_KERNEL] Root workspace created successfully");
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
}

// Implement NetKernel for AsyncWorkspaceServerKernel
#[async_trait::async_trait]
impl<R: Ratchet + Send + Sync + 'static> citadel_sdk::prelude::NetKernel<R>
    for AsyncWorkspaceServerKernel<R>
{
    fn load_remote(&mut self, server_remote: NodeRemote<R>) -> Result<(), NetworkError> {
        println!("[ASYNC_KERNEL] Loading NodeRemote into AsyncWorkspaceServerKernel");

        // Set in both places
        *self.node_remote.write() = Some(server_remote.clone());
        self.domain_operations
            .backend_tx_manager
            .set_node_remote(server_remote);

        Ok(())
    }

    async fn on_start(&self) -> Result<(), NetworkError> {
        println!("[ASYNC_KERNEL] NetKernel started");

        // Re-run admin injection now that NodeRemote is available
        if self.domain_operations.backend_tx_manager.is_test_mode() {
            println!("[ASYNC_KERNEL] ERROR: NodeRemote not set after node start!");
        } else if let Some(workspace_password) = &self.workspace_password {
            println!("[ASYNC_KERNEL] NodeRemote is available, injecting admin and workspace");
            // Inject admin now that we have backend storage
            self.inject_admin_user(workspace_password).await?;
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
                        .ok_or_else(|| NetworkError::Generic("User not found".to_string()))?;

                    info!(target: "citadel", "[ASYNC_KERNEL] User {} connected with cid {} ({})", user_id, connect_success.session_cid, user_cid);

                    // Check if user is already in workspace domain
                    println!("[ASYNC_KERNEL] Checking for root workspace...");

                    // Debug: Check current storage mode
                    if this.domain_operations.backend_tx_manager.is_test_mode() {
                        println!(
                            "[ASYNC_KERNEL] WARNING: Checking workspace in test storage mode!"
                        );
                    } else {
                        println!("[ASYNC_KERNEL] Checking workspace in backend storage mode");
                    }

                    let workspace = match this.get_domain(crate::WORKSPACE_ROOT_ID).await? {
                        Some(domain) => {
                            println!("[ASYNC_KERNEL] Root workspace found");
                            domain
                        }
                        None => {
                            error!(target: "citadel", "[ASYNC_KERNEL] Root workspace not found for user {}", user_id);

                            // Debug: Let's check what domains exist
                            let all_domains = this
                                .domain_operations
                                .backend_tx_manager
                                .get_all_domains()
                                .await?;
                            println!(
                                "[ASYNC_KERNEL] Available domains: {:?}",
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

                        // Add user to workspace using admin privileges
                        use crate::handlers::domain::async_ops::AsyncUserManagementOperations;
                        use citadel_workspace_types::structs::UserRole;
                        this.domain_operations
                            .add_user_to_domain(
                                ADMIN_ROOT_USER_ID,
                                &user_id,
                                crate::WORKSPACE_ROOT_ID,
                                UserRole::Member,
                            )
                            .await?;

                        info!(target: "citadel", "[ASYNC_KERNEL] User {} added to workspace domain", user_id);
                    }

                    let (mut tx, mut rx) = connect_success.channel.split();

                    // Main message processing loop for this connection
                    while let Some(msg) = rx.next().await {
                        match serde_json::from_slice::<WorkspaceProtocolPayload>(msg.as_ref()) {
                            Ok(command_payload) => {
                                if let WorkspaceProtocolPayload::Request(request) = command_payload
                                {
                                    // Process command using async command processor with user context
                                    use crate::kernel::command_processor::async_process_command::process_command_with_user;
                                    let response =
                                        process_command_with_user(&this, &request, &user_id)
                                            .await
                                            .unwrap_or_else(|e| {
                                                WorkspaceProtocolResponse::Error(e.to_string())
                                            });

                                    let response_wrapped =
                                        WorkspaceProtocolPayload::Response(response);
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
                                    WorkspaceProtocolPayload::Response(error_response);
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

                    info!(target: "citadel", "[ASYNC_KERNEL] Connection closed for user {}", user_id);
                    Ok::<(), NetworkError>(())
                });
            }

            NodeResult::Disconnect { .. } => {
                debug!(target: "citadel", "[ASYNC_KERNEL] Client disconnected");
            }

            evt => {
                debug!(target: "citadel", "[ASYNC_KERNEL] Unhandled event: {evt:?}");
            }
        }

        Ok(())
    }

    async fn on_stop(&mut self) -> Result<(), NetworkError> {
        println!("[ASYNC_KERNEL] NetKernel stopping");
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
