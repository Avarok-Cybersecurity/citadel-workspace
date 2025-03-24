use crate::structs::{ConnectionRouterState, PacketHandle};
use citadel_internal_service_types::{InternalServiceRequest, InternalServiceResponse};
use tauri::State;
use tokio::sync::mpsc;
use uuid::Uuid;

mod connect;
// pub mod disconnect;
// pub mod get_session;
mod list_all_peers;
// pub mod list_registered_peers;
// pub mod local_db_clear_all_kv;
// pub mod local_db_delete_kv;
// pub mod local_db_get_all_kv;
// pub mod local_db_get_kv;
// pub mod local_db_set_kv;
// pub mod message;
// pub mod open_connection;
pub mod peer_connect;
// pub mod peer_disconnect;
// pub mod peer_register;
mod list_known_servers;
pub mod register; // this can go private again after RegistrationRequestTS is reformatted

pub use connect::connect;
pub use list_all_peers::list_all_peers;
pub use list_known_servers::list_known_servers;
pub use peer_connect::peer_connect;
pub use register::register;

/// Note: this is a oneshot type of function. One send, one receive only. This is useful for only specific types of commands
/// that don't need to observe multiple responses
pub(crate) async fn send_and_recv(
    payload: InternalServiceRequest,
    request_id: Uuid,
    state: &State<'_, ConnectionRouterState>,
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
    state: &State<'_, ConnectionRouterState>,
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

    // Send message to internal service
    citadel_logging::debug!(
        target: "citadel",
        "Sending message with request_id {}:\n{:?}",
        request_id, payload
    );

    state
        .default_mux
        .send_request(payload)
        .await
        .expect("error sending payload to stream");

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
