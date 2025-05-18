use crate::WorkspaceProtocolResponse;
use citadel_logging::{debug, info};
use citadel_sdk::prelude::{NetworkError, NodeRemote, NodeResult, Ratchet, NetKernel};
use citadel_workspace_types::{WorkspaceProtocolPayload, structs::UserRole};
use citadel_workspace_types::structs::{User, WorkspaceRoles, MetadataValue as InternalMetadataValue, MetadataValue};
use transaction::TransactionManager;
use crate::WORKSPACE_MASTER_PASSWORD_KEY;
use std::sync::Arc;
use tokio::sync::RwLock;
use tokio_stream::StreamExt;
use crate::handlers::domain::server_ops::ServerDomainOps;

pub mod command_processor;
pub mod transaction;

/// Server kernel implementation
pub struct WorkspaceServerKernel<R: Ratchet> {
    // Keep roles separately for now, but might be integrated into transaction manager in the future
    pub roles: Arc<RwLock<WorkspaceRoles>>,
    pub node_remote: Arc<RwLock<Option<NodeRemote<R>>>>,
    pub admin_username: String, // Added field to store admin username
    pub domain_operations: ServerDomainOps<R>,
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
impl<R: Ratchet + Send + Sync + 'static> NetKernel<R>
    for WorkspaceServerKernel<R>
{
    fn load_remote(&mut self, server_remote: NodeRemote<R>) -> Result<(), NetworkError> {
        *self.node_remote.blocking_write() = Some(server_remote);
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
                let server_remote = self.node_remote.read().await.clone().unwrap();
                let peer_command_handler = async move {
                    let user_cid = connect_success.channel.get_session_cid();
                    let user_id = server_remote
                        .account_manager()
                        .get_username_by_cid(connect_success.session_cid)
                        .await?
                        .ok_or_else(|| {
                            NetworkError::msg(format!(
                                "Unable to obtain username. Unknown client: {user_cid}"
                            ))
                        })?;

                    let (mut tx, mut rx) = connect_success.channel.split();

                    while let Some(msg) = rx.next().await {
                        if let Ok(command) =
                            serde_json::from_slice::<WorkspaceProtocolPayload>(msg.as_ref())
                        {
                            if let WorkspaceProtocolPayload::Request(request) = command {
                                let response = this.process_command(&user_id, request);
                                let response = response.unwrap_or_else(|e| {
                                    WorkspaceProtocolResponse::Error(e.to_string())
                                });
                                let response_wrapped = WorkspaceProtocolPayload::Response(response);
                                let serialized_response =
                                    serde_json::to_vec(&response_wrapped).unwrap();
                                // The client receives a WorkspaceProtocolPayload, and should deserialize the message content as such
                                tx.send(serialized_response).await?;
                            } else {
                                citadel_logging::warn!(target: "citadel", "Server received a response when it can only receive commands: {command:?}");
                            }
                        } else {
                            let serialized_response =
                                serde_json::to_vec(&WorkspaceProtocolResponse::Error(
                                    "Invalid command. Failed deserialization".to_string(),
                                ))
                                .unwrap();
                            tx.send(serialized_response).await?;
                        }
                    }

                    Ok::<(), NetworkError>(())
                };

                drop(tokio::task::spawn(async move {
                    if let Err(e) = peer_command_handler.await {
                        citadel_logging::error!(target: "citadel", "Peer command handler failed: {e}");
                    }
                }));
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
            domain_operations: ServerDomainOps::new(tx_manager),
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
            domain_operations: ServerDomainOps::new(transaction_manager),
        }
    }

    /// Convenience constructor for creating a kernel with an admin user
    /// (Used primarily in older code/tests, might need adjustment)
    pub fn with_admin(admin_username: &str, admin_display_name: &str, admin_password: &str) -> Self {
        let kernel = Self::default();

        kernel.inject_admin_user(
            admin_username, 
            admin_display_name, 
            admin_password
        ).expect("Failed to inject admin user during test setup");

        kernel
    }

    /// Helper to inject the initial admin user into the database
    pub fn inject_admin_user(&self, username: &str, display_name: &str, workspace_password: &str) -> Result<(), NetworkError> {
        self.tx_manager().with_write_transaction(|tx| {
            let mut user = User::new(username.to_string(), display_name.to_string(), UserRole::Admin);
            // Store the workspace password in the user's metadata
            user.metadata.insert(WORKSPACE_MASTER_PASSWORD_KEY.to_string(), MetadataValue::String(workspace_password.to_string()));
            tx.insert_user(username.to_string(), user)
        })
    }

    /// Get a domain operations instance
    pub fn domain_ops(&self) -> &ServerDomainOps<R> {
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
    pub async fn verify_workspace_password(&self, provided_password: &str) -> Result<(), NetworkError> {
        // Get the stored password Option from the admin user's metadata within a transaction
        let stored_password_opt = self.tx_manager().with_read_transaction(|tx| {
            // Closure returns Result<Option<InternalMetadataValue>, NetworkError>
            match tx.get_user(&self.admin_username) {
                Some(user) => Ok(user.metadata.get(WORKSPACE_MASTER_PASSWORD_KEY).cloned()),
                None => Err(NetworkError::msg(format!("Admin user {} not found during password verification", self.admin_username))),
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
            Some(_) => Err(NetworkError::msg("Workspace master password stored with incorrect type")), // Handle wrong type
            None => Err(NetworkError::msg("Workspace master password not found in admin metadata")), // Handle missing password
        }
    }

    async fn create_member_user(&self, username: &str, display_name: &str) -> Result<(), NetworkError> {
        info!(target: "citadel", "Creating member user: {}", username);
        // Use write transaction to insert the new member user
        self.tx_manager().with_write_transaction(|tx| {
            // Inside the transaction, create the User struct and insert it
            let user = User::new(username.to_string(), display_name.to_string(), UserRole::Member);
            tx.insert_user(username.to_string(), user)
        })
    }
}
