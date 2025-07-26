use super::core::WorkspaceServerKernel;
use crate::WorkspaceProtocolResponse;
use citadel_logging::{debug, info};
use citadel_sdk::prelude::{NetKernel, NetworkError, NodeRemote, NodeResult, Ratchet};
use citadel_workspace_types::WorkspaceProtocolPayload;
use tokio_stream::StreamExt;

/// Network operations implementation for WorkspaceServerKernel
///
/// This module handles all network-related functionality including connection management,
/// message processing, and event handling through the NetKernel trait implementation.
#[async_trait::async_trait]
impl<R: Ratchet + Send + Sync + 'static> NetKernel<R> for WorkspaceServerKernel<R> {
    /// Load a new NodeRemote into the kernel, replacing any existing one
    ///
    /// This method safely handles the replacement of the node remote by:
    /// 1. Extracting the old remote outside of any locks
    /// 2. Dropping the old remote to clean up resources
    /// 3. Installing the new remote
    fn load_remote(&mut self, server_remote: NodeRemote<R>) -> Result<(), NetworkError> {
        info!(target: "citadel", "WorkspaceServerKernel: load_remote called and server_remote received.");

        let old_node_remote_to_drop: Option<NodeRemote<R>>;

        // Scope 1: Take out the old remote from self.node_remote
        {
            let mut guard = match self.node_remote.try_write() {
                Some(g) => g,
                None => {
                    // Log the error and return, or handle as appropriate for your application's logic.
                    // For now, we'll log and return a generic error, as load_remote is critical.
                    citadel_logging::error!(target: "citadel", "WorkspaceServerKernel: load_remote: Failed to acquire write lock on node_remote (try_write would block).");
                    return Err(NetworkError::Generic(
                        "Failed to acquire lock in load_remote".to_string(),
                    ));
                }
            };
            if guard.is_none() {
                info!(target: "citadel", "WorkspaceServerKernel: load_remote: guard is None before take().");
            } else {
                info!(target: "citadel", "WorkspaceServerKernel: load_remote: guard is Some before take().");
            }
            old_node_remote_to_drop = guard.take(); // Replaces inner with None, returns previous Some(T) or None
            info!(target: "citadel", "WorkspaceServerKernel: load_remote: Took old remote option from RwLock. Releasing lock.");
        } // RwLockWriteGuard for self.node_remote is dropped here, lock released

        // Drop the old remote (if any) outside of any lock on self.node_remote
        if let Some(old_remote) = old_node_remote_to_drop {
            info!(target: "citadel", "WorkspaceServerKernel: load_remote: Dropping previous NodeRemote instance (outside lock).");
            drop(old_remote); // Explicitly drop the old remote
            info!(target: "citadel", "WorkspaceServerKernel: load_remote: Previous NodeRemote instance dropped (outside lock).");
        }

        // Scope 2: Insert the new remote into self.node_remote
        {
            let mut guard = match self.node_remote.try_write() {
                Some(g) => g,
                None => {
                    citadel_logging::error!(target: "citadel", "WorkspaceServerKernel: load_remote: Failed to acquire write lock on node_remote for insertion (try_write would block).");
                    return Err(NetworkError::Generic(
                        "Failed to acquire lock for insertion in load_remote".to_string(),
                    ));
                }
            };
            info!(target: "citadel", "WorkspaceServerKernel: load_remote: Inserting new NodeRemote instance into RwLock.");
            *guard = Some(server_remote);
            info!(target: "citadel", "WorkspaceServerKernel: load_remote: New NodeRemote instance inserted into RwLock.");
        } // RwLockWriteGuard for self.node_remote is dropped here, lock released

        Ok(())
    }

    /// Handle kernel startup
    async fn on_start(&self) -> Result<(), NetworkError> {
        debug!("NetKernel started");
        Ok(())
    }

    /// Handle incoming network events, particularly connection events
    ///
    /// This is the main event processing loop that:
    /// 1. Handles connection success events
    /// 2. Sets up per-connection message processing
    /// 3. Processes workspace protocol messages
    /// 4. Routes commands through the command processor
    async fn on_node_event_received(&self, event: NodeResult<R>) -> Result<(), NetworkError> {
        debug!(target: "citadel", "NetKernel received event: {event:?}");
        match event {
            NodeResult::ConnectSuccess(connect_success) => {
                let this = self.clone();
                tokio::spawn(async move {
                    let _cid = connect_success.session_cid;
                    let user_cid = connect_success.channel.get_session_cid();

                    let account_manager = {
                        let node_remote_guard = this.node_remote.read();
                        match node_remote_guard.as_ref() {
                            Some(remote) => remote.account_manager().clone(),
                            None => {
                                citadel_logging::error!(target: "citadel", "NodeRemote not available during ConnectSuccess for CID {}", connect_success.session_cid);
                                return Err(NetworkError::Generic(
                                    "NodeRemote not available".to_string(),
                                ));
                            }
                        }
                    };

                    let user_id = account_manager
                        .get_username_by_cid(connect_success.session_cid)
                        .await?
                        .ok_or_else(|| NetworkError::Generic("User not found".to_string()))?;

                    info!(target: "citadel", "User {} connected with cid {} ({})", user_id, connect_success.session_cid, user_cid);

                    // TODO: Add user to workspace domain if they aren't already in it
                    let (mut tx, mut rx) = connect_success.channel.split();

                    // Main message processing loop for this connection
                    while let Some(msg) = rx.next().await {
                        match serde_json::from_slice::<WorkspaceProtocolPayload>(msg.as_ref()) {
                            Ok(command_payload) => {
                                if let WorkspaceProtocolPayload::Request(request) = command_payload
                                {
                                    let response =
                                        this.process_command(&user_id, request).unwrap_or_else(
                                            |e| WorkspaceProtocolResponse::Error(e.to_string()),
                                        );
                                    let response_wrapped =
                                        WorkspaceProtocolPayload::Response(response);
                                    match serde_json::to_vec(&response_wrapped) {
                                        Ok(serialized_response) => {
                                            if let Err(e) = tx.send(serialized_response).await {
                                                citadel_logging::error!(target: "citadel", "Failed to send response: {:?}", e);
                                                break;
                                            }
                                        }
                                        Err(e) => {
                                            citadel_logging::error!(target: "citadel", "Failed to serialize response with serde_json: {:?}", e);
                                        }
                                    }
                                } else {
                                    citadel_logging::warn!(target: "citadel", "Server received a WorkspaceProtocolPayload::Response when it expected a Request: {:?}", command_payload);
                                }
                            }
                            Err(e) => {
                                citadel_logging::error!(target: "citadel", "Failed to deserialize command with serde_json: {:?}. Message (first 50 bytes): {:?}", e, msg.as_ref().iter().take(50).collect::<Vec<_>>());
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
                                            citadel_logging::error!(target: "citadel", "Failed to send deserialization error response: {:?}", send_err);
                                            break;
                                        }
                                    }
                                    Err(serialize_err) => {
                                        citadel_logging::error!(target: "citadel", "Failed to serialize deserialization error response with serde_json: {:?}", serialize_err);
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
        Ok(())
    }

    /// Handle kernel shutdown
    async fn on_stop(&mut self) -> Result<(), NetworkError> {
        debug!("NetKernel stopped");
        Ok(())
    }
}

impl<R: Ratchet> WorkspaceServerKernel<R> {
    /// Sets the NodeRemote after the node has been built
    ///
    /// This method provides a way to set the node remote after kernel initialization,
    /// which is useful when the remote is not available during construction.
    pub async fn set_node_remote(&self, node_remote: NodeRemote<R>) {
        let mut remote_guard = self.node_remote.write();
        *remote_guard = Some(node_remote);
        info!(target: "citadel", "NodeRemote set for WorkspaceServerKernel");
    }
}
