use crate::handlers::domain::functions::user;
use crate::handlers::domain::server_ops::DomainServerOperations;
use crate::WorkspaceProtocolResponse;
use crate::WORKSPACE_MASTER_PASSWORD_KEY;
use crate::WORKSPACE_ROOT_ID; // Added this import
use bincode;
use citadel_logging::{debug, info};
use citadel_sdk::prelude::{NetKernel, NetworkError, NodeRemote, NodeResult, Ratchet};
use citadel_workspace_types::structs::{
    MetadataValue as InternalMetadataValue, MetadataValue, Permission, User, WorkspaceRoles,
};
use citadel_workspace_types::{structs::UserRole, WorkspaceProtocolPayload};
use std::collections::HashSet;
use std::sync::Arc;
use tokio::sync::RwLock;
use tokio_stream::StreamExt;
use transaction::TransactionManager;

pub mod command_processor;
pub mod transaction;

/// Server kernel implementation
pub struct WorkspaceServerKernel<R: Ratchet> {
    // Keep roles separately for now, but might be integrated into transaction manager in the future
    pub roles: Arc<RwLock<WorkspaceRoles>>,
    pub node_remote: Arc<RwLock<Option<NodeRemote<R>>>>,
    pub admin_username: String, // Added field to store admin username
    pub domain_operations: DomainServerOperations<R>,
}

impl<R: Ratchet> Clone for WorkspaceServerKernel<R> {
    fn clone(&self) -> Self {
        Self {
            roles: self.roles.clone(),
            node_remote: self.node_remote.clone(),
            admin_username: self.admin_username.clone(),
            domain_operations: self.domain_operations.clone(),
        }
    }
}

/// Actions for updating domain members
pub enum MemberAction {
    Add,
    Remove,
}

#[async_trait::async_trait]
impl<R: Ratchet + Send + Sync + 'static> NetKernel<R> for WorkspaceServerKernel<R> {
    fn load_remote(&mut self, server_remote: NodeRemote<R>) -> Result<(), NetworkError> {
        citadel_logging::info!(target: "citadel", "WorkspaceServerKernel: load_remote called and server_remote received.");

        let old_node_remote_to_drop: Option<NodeRemote<R>>;

        // Scope 1: Take out the old remote from self.node_remote
        {
            let mut guard = match self.node_remote.try_write() {
                Ok(g) => g,
                Err(_would_block_err) => {
                    // Log the error and return, or handle as appropriate for your application's logic.
                    // For now, we'll log and return a generic error, as load_remote is critical.
                    citadel_logging::error!(target: "citadel", "WorkspaceServerKernel: load_remote: Failed to acquire write lock on node_remote (try_write would block).");
                    return Err(NetworkError::Generic(
                        "Failed to acquire lock in load_remote".to_string(),
                    ));
                }
            };
            if guard.is_none() {
                citadel_logging::info!(target: "citadel", "WorkspaceServerKernel: load_remote: guard is None before take().");
            } else {
                citadel_logging::info!(target: "citadel", "WorkspaceServerKernel: load_remote: guard is Some before take().");
            }
            old_node_remote_to_drop = guard.take(); // Replaces inner with None, returns previous Some(T) or None
            citadel_logging::info!(target: "citadel", "WorkspaceServerKernel: load_remote: Took old remote option from RwLock. Releasing lock.");
        } // RwLockWriteGuard for self.node_remote is dropped here, lock released

        // Drop the old remote (if any) outside of any lock on self.node_remote
        if let Some(old_remote) = old_node_remote_to_drop {
            citadel_logging::info!(target: "citadel", "WorkspaceServerKernel: load_remote: Dropping previous NodeRemote instance (outside lock).");
            drop(old_remote); // Explicitly drop the old remote
            citadel_logging::info!(target: "citadel", "WorkspaceServerKernel: load_remote: Previous NodeRemote instance dropped (outside lock).");
        }

        // Scope 2: Insert the new remote into self.node_remote
        {
            let mut guard = match self.node_remote.try_write() {
                Ok(g) => g,
                Err(_would_block_err) => {
                    citadel_logging::error!(target: "citadel", "WorkspaceServerKernel: load_remote: Failed to acquire write lock on node_remote for insertion (try_write would block).");
                    return Err(NetworkError::Generic(
                        "Failed to acquire lock for insertion in load_remote".to_string(),
                    ));
                }
            };
            citadel_logging::info!(target: "citadel", "WorkspaceServerKernel: load_remote: Inserting new NodeRemote instance into RwLock.");
            *guard = Some(server_remote);
            citadel_logging::info!(target: "citadel", "WorkspaceServerKernel: load_remote: New NodeRemote instance inserted into RwLock.");
        } // RwLockWriteGuard for self.node_remote is dropped here, lock released

        Ok(())
    }

    async fn on_start(&self) -> Result<(), NetworkError> {
        debug!("NetKernel started");
        Ok(())
    }

    async fn on_node_event_received(&self, event: NodeResult<R>) -> Result<(), NetworkError> {
        citadel_logging::debug!(target: "citadel", "NetKernel received event: {event:?}");
        match event {
            NodeResult::ConnectSuccess(connect_success) => {
                let this = self.clone();
                // Spawn a task to handle the connection success event
                tokio::spawn(async move {
                    let _cid = connect_success.session_cid; // Use session_cid
                    let user_cid = connect_success.channel.get_session_cid();

                    let node_remote_guard = this.node_remote.read().await;
                    let account_manager = match node_remote_guard.as_ref() {
                        Some(remote) => remote.account_manager(),
                        None => {
                            citadel_logging::error!(target: "citadel", "NodeRemote not available during ConnectSuccess for CID {}", connect_success.session_cid);
                            return Err(NetworkError::Generic(
                                "NodeRemote not available".to_string(),
                            ));
                        }
                    };

                    let user_id = account_manager
                        .get_username_by_cid(connect_success.session_cid)
                        .await?
                        .ok_or_else(|| NetworkError::Generic("User not found".to_string()))?;

                    citadel_logging::info!(target: "citadel", "User {} connected with cid {} ({})", user_id, connect_success.session_cid, user_cid);

                    // Attempt to register the user's CID with their user ID
                    // This is crucial for routing messages correctly
                    // @human-review: The method `register_user_cid` was not found on `DomainOperations`.
                    // The SDK's `AccountManager` already provides `get_username_by_cid`, so the necessity of
                    // explicit CID registration at the domain layer for message routing needs re-evaluation.
                    // If issues arise with message routing to specific user sessions, this might be the cause.
                    /*
                    match this.domain_operations.register_user_cid(&user_id, connect_success.session_cid).await {
                        Ok(_) => {
                            citadel_logging::info!(target: "citadel", "Successfully registered CID {} for user {}", connect_success.session_cid, user_id);
                        }
                        Err(e) => {
                            citadel_logging::error!(target: "citadel", "Failed to register CID {} for user {}: {:?}", connect_success.session_cid, user_id, e);
                        }
                    }
                    */

                    let (mut tx, mut rx) = connect_success.channel.split();

                    while let Some(msg) = rx.next().await {
                        // Deserialize with bincode instead of serde_json
                        match bincode::deserialize::<WorkspaceProtocolPayload>(msg.as_ref()) {
                            Ok(command_payload) => {
                                if let WorkspaceProtocolPayload::Request(request) = command_payload
                                {
                                    let response = this.process_command(&user_id, request);
                                    let response = response.unwrap_or_else(|e| {
                                        WorkspaceProtocolResponse::Error(e.to_string())
                                    });
                                    let response_wrapped =
                                        WorkspaceProtocolPayload::Response(response);
                                    // Serialize with bincode instead of serde_json
                                    match bincode::serialize(&response_wrapped) {
                                        Ok(serialized_response) => {
                                            if let Err(e) = tx.send(serialized_response).await {
                                                citadel_logging::error!(target: "citadel", "Failed to send response: {:?}", e);
                                                break; // Exit loop on send error
                                            }
                                        }
                                        Err(e) => {
                                            citadel_logging::error!(target: "citadel", "Failed to serialize response with bincode: {:?}", e);
                                            // Optionally send a generic error back if serialization fails
                                        }
                                    }
                                } else {
                                    citadel_logging::warn!(target: "citadel", "Server received a WorkspaceProtocolPayload::Response when it expected a Request: {:?}", command_payload);
                                    // It's unusual for the server to receive a Response type directly from the client here.
                                    // Decide if an error response is appropriate.
                                }
                            }
                            Err(e) => {
                                citadel_logging::error!(target: "citadel", "Failed to deserialize command with bincode: {:?}. Message (first 50 bytes): {:?}", e, msg.as_ref().iter().take(50).collect::<Vec<_>>());
                                // Construct an error response, wrap it in WorkspaceProtocolPayload, and serialize with bincode
                                let error_response = WorkspaceProtocolResponse::Error(format!(
                                    "Invalid command. Failed bincode deserialization: {}",
                                    e
                                ));
                                let response_wrapped =
                                    WorkspaceProtocolPayload::Response(error_response);
                                match bincode::serialize(&response_wrapped) {
                                    Ok(serialized_error_response) => {
                                        if let Err(send_err) =
                                            tx.send(serialized_error_response).await
                                        {
                                            citadel_logging::error!(target: "citadel", "Failed to send deserialization error response: {:?}", send_err);
                                            break; // Exit loop on send error
                                        }
                                    }
                                    Err(serialize_err) => {
                                        citadel_logging::error!(target: "citadel", "Failed to serialize deserialization error response with bincode: {:?}", serialize_err);
                                    }
                                }
                            }
                        }
                    }

                    Ok::<(), NetworkError>(())
                });
            }

            evt => {
                debug!("Unhandled event: {evt:?}");
            }
        }
        // TODO: Handle node events or this implementation is useless
        Ok(())
    }

    async fn on_stop(&mut self) -> Result<(), NetworkError> {
        debug!("NetKernel stopped");
        Ok(())
    }
}

impl<R: Ratchet> Default for WorkspaceServerKernel<R> {
    fn default() -> Self {
        let tx_manager = Arc::new(TransactionManager::default());
        Self {
            roles: Arc::new(RwLock::new(WorkspaceRoles::new())),
            node_remote: Arc::new(RwLock::new(None)),
            admin_username: String::new(),
            domain_operations: DomainServerOperations::new(tx_manager),
        }
    }
}

impl<R: Ratchet> WorkspaceServerKernel<R> {
    /// Create a new WorkspaceServerKernel without any default users
    pub fn new(
        transaction_manager: Arc<TransactionManager>,
        node_remote: Option<NodeRemote<R>>,
        admin_username: String,
    ) -> Self {
        Self {
            roles: Arc::new(RwLock::new(WorkspaceRoles::new())), // Initialize roles
            node_remote: Arc::new(RwLock::new(node_remote)),
            admin_username,
            domain_operations: DomainServerOperations::new(transaction_manager),
        }
    }

    /// Convenience constructor for creating a kernel with an admin user
    /// (Used primarily in older code/tests, might need adjustment)
    pub fn with_admin(
        admin_username: &str,
        admin_display_name: &str,
        admin_password: &str,
    ) -> Self {
        let kernel = Self::default();

        kernel
            .inject_admin_user(admin_username, admin_display_name, admin_password)
            .expect("Failed to inject admin user during test setup");

        kernel
    }

    /// Helper to inject the initial admin user into the database
    pub fn inject_admin_user(
        &self,
        username: &str,
        display_name: &str,
        workspace_password: &str,
    ) -> Result<(), NetworkError> {
        self.tx_manager().with_write_transaction(|tx| {
            let mut user = User::new(
                username.to_string(),
                display_name.to_string(),
                UserRole::Admin,
            );

            // Grant the admin user all permissions on the root workspace
            let mut root_permissions = HashSet::new();
            root_permissions.insert(Permission::All);
            user.permissions
                .insert(WORKSPACE_ROOT_ID.to_string(), root_permissions);

            // Store the workspace password in the user's metadata
            user.metadata.insert(
                WORKSPACE_MASTER_PASSWORD_KEY.to_string(),
                MetadataValue::String(workspace_password.to_string()),
            );
            // Ensure the root workspace domain exists
            if tx.get_domain(WORKSPACE_ROOT_ID).is_none() {
                let root_workspace_obj = citadel_workspace_types::structs::Workspace {
                    id: WORKSPACE_ROOT_ID.to_string(),
                    name: "Root Workspace".to_string(),
                    description: "The main workspace for this instance.".to_string(),
                    owner_id: username.to_string(),
                    members: vec![username.to_string()],
                    offices: Vec::new(),
                    metadata: Default::default(), // Vec::new() for Vec<u8>
                    password_protected: false,    // Added missing field
                };

                // Use the enum variant for Domain
                let root_domain_enum_variant =
                    citadel_workspace_types::structs::Domain::Workspace {
                        workspace: root_workspace_obj,
                    };

                tx.insert_domain(WORKSPACE_ROOT_ID.to_string(), root_domain_enum_variant)?;
            }

            tx.insert_user(username.to_string(), user)
        })
    }

    /// Get a domain operations instance
    pub fn domain_ops(&self) -> &DomainServerOperations<R> {
        &self.domain_operations
    }

    // Retyrn the transaction manager
    pub fn tx_manager(&self) -> &Arc<TransactionManager> {
        &self.domain_operations.tx_manager
    }

    /// Sets the NodeRemote after the node has been built.
    pub async fn set_node_remote(&self, node_remote: NodeRemote<R>) {
        let mut remote_guard = self.node_remote.write().await; // Keep .await here as this function is async
        *remote_guard = Some(node_remote);
        info!(target: "citadel", "NodeRemote set for WorkspaceServerKernel");
    }

    /// Verifies the provided workspace password against the one stored for the admin user
    pub async fn verify_workspace_password(
        &self,
        provided_password: &str,
    ) -> Result<(), NetworkError> {
        // Get the stored password Option from the admin user's metadata within a transaction
        let stored_password_opt = self.tx_manager().with_read_transaction(|tx| {
            // Closure returns Result<Option<InternalMetadataValue>, NetworkError>
            match tx.get_user(&self.admin_username) {
                Some(user) => Ok(user.metadata.get(WORKSPACE_MASTER_PASSWORD_KEY).cloned()),
                None => Err(NetworkError::msg(format!(
                    "Admin user {} not found during password verification",
                    self.admin_username
                ))),
            }
        })?; // Handle potential transaction error

        // Now, handle the Option containing the password value
        match stored_password_opt {
            Some(InternalMetadataValue::String(stored_password)) => {
                // Compare the stored password with the provided password
                if provided_password == stored_password {
                    Ok(())
                } else {
                    Err(NetworkError::msg("Incorrect workspace master password"))
                }
            }
            Some(_) => Err(NetworkError::msg(
                "Workspace master password stored with incorrect type",
            )), // Handle wrong type
            None => Err(NetworkError::msg(
                "Workspace master password not found in admin metadata",
            )), // Handle missing password
        }
    }

    pub fn add_member(
        &self,
        actor_user_id: &str,
        target_user_id: &str,
        domain_id: Option<&str>, // Can be Workspace, Office, or Room ID
        role: UserRole,
        metadata: Option<Vec<u8>>,
    ) -> Result<(), NetworkError> {
        let mut tx = self.tx_manager().write_transaction();
        let domain_id_str = domain_id.ok_or_else(|| {
            NetworkError::msg("Domain ID must be provided to add a member to a domain")
        })?;

        user::add_user_to_domain_inner(
            &mut tx,
            actor_user_id,
            target_user_id,
            domain_id_str,
            role,
            metadata,
        )
    }

    pub fn remove_member(
        &self,
        actor_user_id: &str,
        target_user_id: &str,
    ) -> Result<(), NetworkError> {
        let mut tx = self.tx_manager().write_transaction();
        user::remove_user_from_domain_inner(
            &mut tx,
            actor_user_id,
            target_user_id,
            WORKSPACE_ROOT_ID,
        )
    }
}
