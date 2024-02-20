use crate::structs::ConnectionState;
use citadel_internal_service_types::InternalServiceRequest;
use futures::SinkExt;
use tauri::State;

pub mod connect;
pub mod disconnect;
pub mod get_session;
pub mod list_all_peers;
pub mod message;
pub mod open_connection;
pub mod peer_connect;
pub mod peer_disconnect;
pub mod peer_register;
pub mod register;

pub(crate) async fn send_to_internal_service(
    request: InternalServiceRequest,
    state: State<'_, ConnectionState>,
) -> Result<(), String> {
    state
        .sink
        .lock()
        .await
        .as_mut()
        .ok_or("No connection to the internal service set")?
        .send(request)
        .await
        .map_err(|err| err.to_string())
}
