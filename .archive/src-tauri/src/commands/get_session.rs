use crate::commands::send_to_internal_service;
use citadel_internal_service_types::InternalServiceRequest;
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

    send_to_internal_service(payload, state).await?;
    Ok(request_id.to_string())
}
