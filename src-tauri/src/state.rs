use std::collections::HashMap;
use std::sync::Arc;

use citadel_internal_service_connector::messenger::{
    backend::CitadelWorkspaceBackend, CitadelWorkspaceMessenger,
};
use citadel_internal_service_connector::messenger::{MessengerError, MessengerTx};
use citadel_internal_service_types::InternalServiceResponse;
use citadel_types::crypto::SecurityLevel;
use citadel_workspace_types::{WorkspaceProtocolPayload, WorkspaceProtocolRequest};
use serde::{Deserialize, Serialize};
use tokio::sync::mpsc::UnboundedSender;
use tokio::sync::{OnceCell, RwLock};
use uuid::Uuid;

pub struct PacketHandle {
    pub channel: UnboundedSender<InternalServiceResponse>, // The channel to stream the response to
}

pub type WorkspaceState = Arc<WorkspaceStateInner>;

pub struct WorkspaceStateInner {
    pub messenger: CitadelWorkspaceMessenger<CitadelWorkspaceBackend>,
    pub to_subscribers: RwLock<HashMap<Uuid, PacketHandle>>,
    pub default_mux: MessengerTx<CitadelWorkspaceBackend>,
    pub muxes: RwLock<HashMap<u64, MessengerTx<CitadelWorkspaceBackend>>>,
    pub window: OnceCell<tauri::AppHandle>,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct Payload {
    pub packet: InternalServiceResponse,
    pub error: bool,
    pub notification: bool,
}

impl WorkspaceStateInner {
    /// Sends a command to either the server or a peer. All messages sent must come through here
    /// to ensure consistency in schema
    pub async fn send_workspace_command(
        &self,
        cid: u64,
        peer_cid: Option<u64>,
        security_level: SecurityLevel,
        command: impl Into<WorkspaceProtocolPayload>,
    ) -> Result<(), MessengerError> {
        if cid == 0 {
            Err(MessengerError::OtherError {
                reason: "Cannot send command to the zero CID".to_owned(),
            })
        } else {
            let read = self.muxes.read().await;
            let tx = read.get(&cid).ok_or(MessengerError::OtherError { reason: format!("CID {} not found in muxes. Make sure to call open_messenger_for first before calling this function", cid) })?;
            let peer_cid = peer_cid.unwrap_or(0); // if 0, then is sent to the server
            let serialized = serde_json::to_vec(&command.into()).unwrap();
            tx.send_message_to_with_security_level(peer_cid, security_level, serialized)
                .await
        }
    }
    /// When a new connection is established between a client and server or peer-to-peer,
    /// this function should be called to open a new messenger for the connection.
    ///
    /// This is required to ensure proper synchronization and proper message delivery in
    /// indeterminate network and OS conditions.
    ///
    /// # Arguments
    ///
    /// * `cid` - The connection ID of the client or server.
    ///
    /// # Returns
    ///
    /// * `Ok(())` - The messenger was opened successfully.
    /// * `Err(MessengerError)` - The messenger could not be opened.
    ///
    /// # Errors
    ///
    /// * `MessengerError::OtherError` - The connection ID was already in use.
    ///
    /// # Examples
    ///
    /// ```ignore
    /// let state = ConnectionRouterState::new();
    /// state.open_messenger_for(1).await?;
    /// ```
    pub async fn open_messenger_for(&self, cid: u64) -> Result<(), MessengerError> {
        let tx = self.messenger.multiplex(cid).await?;
        if self.muxes.write().await.insert(cid, tx).is_some() {
            return Err(MessengerError::OtherError { reason: format!("CID {} was already in use. Make sure to call close_messenger_for first before calling this function", cid) });
        }
        Ok(())
    }

    /// Sends a message to a peer with a specified security level.
    ///
    /// This function requires that the connection has been established and a messenger has been opened for it.
    ///
    /// # Arguments
    ///
    /// * `cid` - The connection ID of the client or server.
    /// * `peer_cid` - The connection ID of the peer.
    /// * `security_level` - The security level of the message.
    /// * `payload` - The payload of the message.
    ///
    /// # Returns
    ///
    /// * `Ok(())` - The message was sent successfully.
    /// * `Err(MessengerError)` - The message could not be sent.
    ///
    /// # Errors
    ///
    /// * `MessengerError::OtherError` - The connection ID was not found in the muxes.
    ///
    /// # Examples
    ///
    /// ```ignore
    /// let state = ConnectionRouterState::new();
    /// state.open_messenger_for(1).await?;
    /// state.send_message_with_security_level(1, 2, SecurityLevel::Standard, b"Hello, World!").await?;
    /// ```
    pub async fn send_message_with_security_level(
        &self,
        cid: u64,
        peer_cid: Option<u64>,
        security_level: SecurityLevel,
        payload: impl Into<Vec<u8>>,
    ) -> Result<(), MessengerError> {
        let command = WorkspaceProtocolRequest::Message {
            contents: payload.into(),
        };
        self.send_workspace_command(cid, peer_cid, security_level, command)
            .await
    }

    /// Closes the messenger for a connection.
    ///
    /// This function requires that the connection has been established and a messenger has been opened for it.
    ///
    /// # Arguments
    ///
    /// * `cid` - The connection ID of the client or server.
    ///
    /// # Returns
    ///
    /// * `Ok(())` - The messenger was closed successfully.
    /// * `Err(MessengerError)` - The messenger could not be closed.
    ///
    /// # Errors
    ///
    /// * `MessengerError::OtherError` - The connection ID was not found in the muxes.
    ///
    /// # Examples
    ///
    /// ```ignore
    /// let state = ConnectionRouterState::new();
    /// state.open_messenger_for(1).await?;
    /// state.close_messenger_for(1).await?;
    /// ```
    pub async fn close_messenger_for(&self, cid: u64) -> Result<(), MessengerError> {
        if self.muxes.write().await.remove(&cid).is_none() {
            Err(MessengerError::OtherError { reason: format!("CID {} not found in muxes. Make sure to call open_messenger_for first before calling this function", cid) })
        } else {
            Ok(())
        }
    }
}
