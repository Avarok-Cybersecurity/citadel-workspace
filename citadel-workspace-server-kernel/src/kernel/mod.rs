use crate::handlers::transaction::TransactionManager;
use crate::WorkspaceProtocolResponse;
use citadel_logging::debug;
use citadel_sdk::prelude::{NetworkError, NodeRemote, NodeResult, Ratchet};
use citadel_workspace_types::structs::{User, UserRole, WorkspaceRoles};
use citadel_workspace_types::WorkspaceProtocolPayload;
use futures::StreamExt;
use parking_lot::RwLock;
use std::collections::HashMap;
use std::sync::Arc;

pub mod command_processor;
pub mod domain;
pub mod transaction;

/// Server kernel implementation
pub struct WorkspaceServerKernel<R: Ratchet> {
    // Transaction manager serves as a single source of truth for domains and users
    pub transaction_manager: Arc<TransactionManager>,
    // Keep roles separately for now, but might be integrated into transaction manager in the future
    pub roles: Arc<RwLock<WorkspaceRoles>>,
    pub node_remote: Arc<RwLock<Option<NodeRemote<R>>>>,
}

impl<R: Ratchet> Clone for WorkspaceServerKernel<R> {
    fn clone(&self) -> Self {
        Self {
            transaction_manager: self.transaction_manager.clone(),
            roles: self.roles.clone(),
            node_remote: self.node_remote.clone(),
        }
    }
}

/// Actions for updating domain members
pub enum MemberAction {
    Add,
    Remove,
}

#[async_trait::async_trait]
impl<R: Ratchet + Send + Sync + 'static> citadel_sdk::prelude::NetKernel<R>
    for WorkspaceServerKernel<R>
{
    fn load_remote(&mut self, server_remote: NodeRemote<R>) -> Result<(), NetworkError> {
        *self.node_remote.write() = Some(server_remote);
        Ok(())
    }

    async fn on_start(&self) -> Result<(), NetworkError> {
        debug!("NetKernel started");
        Ok(())
    }

    async fn on_node_event_received(&self, event: NodeResult<R>) -> Result<(), NetworkError> {
        debug!("NetKernel received event: {event:?}");
        match event {
            NodeResult::ConnectSuccess(connect_success) => {
                let this = self.clone();
                let peer_command_handler = async move {
                    let user_id = connect_success.channel.get_session_cid().to_string();
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
                                let serialized_response = serde_json::to_vec(&response).unwrap();
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

                drop(tokio::task::spawn(peer_command_handler));
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
        Self {
            transaction_manager: Arc::new(TransactionManager::default()),
            roles: Arc::new(RwLock::new(WorkspaceRoles::new())),
            node_remote: Arc::new(RwLock::new(None)),
        }
    }
}

impl<R: Ratchet> WorkspaceServerKernel<R> {
    /// Create a new WorkspaceServerKernel without any default users
    pub fn new() -> Self {
        Self::default()
    }

    /// Create a new WorkspaceServerKernel with a specified admin user
    pub fn with_admin(admin_id: &str, admin_name: &str) -> Self {
        let kernel = Self::default();
        kernel.inject_admin_user(admin_id, admin_name).unwrap();
        kernel
    }

    pub fn inject_admin_user(&self, admin_id: &str, admin_name: &str) -> Result<(), NetworkError> {
        // Use transaction manager to add the admin user
        let permissions = HashMap::new();
        let admin_user = User {
            id: admin_id.to_string(),
            name: admin_name.to_string(),
            role: UserRole::Admin,
            permissions,
        };

        // Add admin user through transaction manager
        let _ = self
            .transaction_manager
            .with_write_transaction(|tx| tx.insert_user(admin_id.to_string(), admin_user));

        Ok(())
    }

    /// Get a reference to the transaction manager
    pub fn transaction_manager(&self) -> &Arc<TransactionManager> {
        &self.transaction_manager
    }

    /// Execute a function with a read transaction
    pub fn with_read_transaction<F, T>(&self, f: F) -> Result<T, NetworkError>
    where
        F: FnOnce(&dyn crate::handlers::transaction::Transaction) -> Result<T, NetworkError>,
    {
        self.transaction_manager.with_read_transaction(f)
    }

    /// Execute a function with a write transaction
    pub fn with_write_transaction<F, T>(&self, f: F) -> Result<T, NetworkError>
    where
        F: FnOnce(&mut dyn crate::handlers::transaction::Transaction) -> Result<T, NetworkError>,
    {
        self.transaction_manager.with_write_transaction(f)
    }
}
