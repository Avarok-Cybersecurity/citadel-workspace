use crate::structs::{ConnectionState, PacketHandle};
use citadel_internal_service_types::{InternalServiceRequest, InternalServiceResponse};
use futures::SinkExt;
use tauri::State;
use tokio::sync::mpsc;
use uuid::Uuid;

// pub mod connect;
// pub mod disconnect;
// pub mod get_session;
// pub mod list_all_peers;
// pub mod list_registered_peers;
// pub mod local_db_clear_all_kv;
// pub mod local_db_delete_kv;
// pub mod local_db_get_all_kv;
// pub mod local_db_get_kv;
// pub mod local_db_set_kv;
// pub mod message;
// pub mod open_connection;
// pub mod peer_connect;
// pub mod peer_disconnect;
// pub mod peer_register;
pub mod register;

pub(crate) async fn send_and_recv(
    payload: InternalServiceRequest,
    request_id: Uuid,
    state: &State<'_, ConnectionState>,
) -> Result<InternalServiceResponse, String> {
    // Send message to internal service
    println!(
        "Sending message with request_id {}:\n{:#?}",
        request_id, payload
    );
    let mut guard = state.sink.lock().await;
    guard.send(payload).await.map_err(|err| err.to_string())?;
    drop(guard);

    // Create a new mpsc channel and attach the request id to it
    let (tx, mut rx) = mpsc::channel::<InternalServiceResponse>(1024);
    let packet_handle = PacketHandle {
        request_id,
        channel: tx,
    };

    // Attach the mpsc channel to the vector of listeners
    // NOTE: be careful touching this; very easy to end up in a deadlock
    let mut guard = state.listeners.lock().await;
    guard.push(packet_handle);
    drop(guard);

    // Wait for the background TCP listener (main.rs) to dispatch the message
    let incoming = match rx.recv().await {
        Some(v) => v,
        None => return Err("Channel closed before response.".to_owned()),
    };

    // Remove channel from handles
    let mut guard = state.listeners.lock().await;
    if let Some(index) = guard.iter().position(|h| h.request_id == request_id) {
        guard.remove(index);
    } else {
        return Err("PacketHandle was unexpectedly dropped by a third party.".to_owned());
    }
    drop(guard);

    Ok(incoming)
}

// pub(crate) async fn send_to_internal_service(
//     request: InternalServiceRequest,
//     state: State<'_, ConnectionState>,
// ) -> Result<(), String> {
//     state
//         .sink
//         .lock()
//         .await
//         .as_mut()
//         .ok_or("No connection to the internal service set")?
//         .send(request)
//         .await
//         .map_err(|err| err.to_string())
// }
