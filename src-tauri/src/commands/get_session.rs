use citadel_internal_service_types::InternalServiceRequest;
use futures::SinkExt;
use tauri::State;
use uuid::Uuid;

use crate::structs::ConnectionState;

#[tauri::command]
pub async fn get_sessions(
    _window: tauri::Window,
    state: State<'_, ConnectionState>,
) -> Result<String, String> {
    let request_id = Uuid::new_v4();
    let payload = InternalServiceRequest::GetSessions { request_id };

    if state
        .sink
        .lock()
        .await
        .as_mut()
        .unwrap()
        .send(payload)
        .await
        .is_ok()
    {
        Ok(request_id.to_string())
    } else {
        Err("Unable to get_session".to_string())
    }
}
