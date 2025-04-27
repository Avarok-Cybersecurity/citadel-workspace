use crate::state::{PacketHandle, WorkspaceState};
use citadel_internal_service_types::{InternalServiceRequest, InternalServiceResponse};
use tauri::State;
use tokio::sync::mpsc;
use uuid::Uuid;

mod connect;
mod disconnect;
mod get_registration;
mod get_session;
mod list_all_peers;
mod list_known_servers;
mod list_registered_peers;
mod local_db_clear_all_kv;
mod local_db_delete_kv;
mod local_db_get_all_kv;
mod local_db_get_kv;
mod local_db_set_kv;
mod peer_connect;
mod peer_disconnect;
mod peer_register;
pub mod register;
mod workspace_request;

pub use connect::connect;
pub use disconnect::disconnect;
pub use get_registration::get_registration;
pub use get_session::get_sessions;
pub use list_all_peers::list_all_peers;
pub use list_known_servers::list_known_servers;
pub use list_registered_peers::list_registered_peers;
pub use local_db_clear_all_kv::local_db_clear_all_kv;
pub use local_db_delete_kv::local_db_delete_kv;
pub use local_db_get_all_kv::local_db_get_all_kv;
pub use local_db_get_kv::local_db_get_kv;
pub use local_db_set_kv::local_db_set_kv;
pub use peer_connect::peer_connect;
pub use peer_disconnect::peer_disconnect;
pub use peer_register::peer_register;
pub use register::register;
pub use workspace_request::send_workspace_request;

/// Note: this is a oneshot type of function. One send, one receive only. This is useful for only specific types of commands
/// that don't need to observe multiple responses
pub(crate) async fn send_and_recv(
    payload: InternalServiceRequest,
    request_id: Uuid,
    state: &State<'_, WorkspaceState>,
) -> InternalServiceResponse {
    send_and_recv_with_inspector(payload, request_id, state, InspectionResult::Done).await
}

pub enum InspectionResult<T> {
    Done(T),
    Continue,
}

/// This can be used to stream potentially many possible responses
pub(crate) async fn send_and_recv_with_inspector<F, T>(
    payload: InternalServiceRequest,
    request_id: Uuid,
    state: &State<'_, WorkspaceState>,
    mut inspector: F,
) -> T
where
    F: FnMut(InternalServiceResponse) -> InspectionResult<T>,
{
    // Create a new mpsc channel and attach the request id to it
    let (tx, mut rx) = mpsc::unbounded_channel::<InternalServiceResponse>();
    let packet_handle = PacketHandle { channel: tx };

    // Attach the mpsc channel to the vector of listeners
    // NOTE: be careful touching this; very easy to end up in a deadlock
    let mut guard = state.to_subscribers.write().await;
    guard.insert(request_id, packet_handle);
    drop(guard);

    // Send request to internal service
    citadel_logging::debug!(
        target: "citadel",
        "Sending request with request_id {}:\n{:?}",
        request_id, payload
    );

    match payload {
        InternalServiceRequest::Message {
            cid,
            peer_cid: Some(peer_cid),
            message,
            request_id,
            security_level,
        } => {
            // We only care to send messages using the reliable messenger via the mux'ed p2p handle
            // For messages sent to the server, we assume the server is always online, and if not,
            // the client can always retry. Thus, when the request is a message type and peer_cid is
            // Some, we use this branch.
            state
                .send_message_with_security_level(
                    cid,
                    Some(peer_cid),
                    security_level,
                    request_id,
                    message,
                )
                .await
                .expect("send_and_recv: Failed to send message")
        }

        payload => {
            // In the case of a Message type with a None for peer_cid, it will still be propagated
            // to the server. The server will respond with a WorkspaceProtocolPayload per usual,
            // since the InternalServiceRequest/Response::Message has a subprotocol for WorkspaceProtocolPayload
            // In all other cases, the InternalServiceResponse will be handled appropriately by the internal service.
            state
                .bypasser
                .send(payload)
                .await
                .expect("send_and_recv: Failed to send bypasser payload")
        }
    }

    loop {
        // Wait for the background TCP listener (main.rs) to dispatch the message
        let incoming = match rx.recv().await {
            Some(v) => v,
            None => panic!("Channel unexpectedly closed before response."),
        };

        match inspector(incoming) {
            InspectionResult::Done(v) => {
                // Remove channel from handles
                let mut guard = state.to_subscribers.write().await;
                if guard.remove(&request_id).is_none() {
                    panic!(
                        "PacketHandle was unexpectedly dropped by a third party, likely due to a UUID collision?"
                    );
                }

                return v;
            }
            InspectionResult::Continue => continue,
        }
    }
}
