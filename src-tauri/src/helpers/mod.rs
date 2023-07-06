pub mod types;
use crate::ConnectionState;
use citadel_workspace_types::InternalServicePayload;
use tauri::State;

pub(crate) async fn send_to_service(
    state: State<'_, ConnectionState>,
    payload: InternalServicePayload,
) {
    let sink = state.sink.lock().await.as_mut().unwrap();
}

pub(crate) async fn get_from_the_service(state: State<'_, ConnectionState>) {
    let stream = state.stream.lock().await.as_mut().unwrap();
}
