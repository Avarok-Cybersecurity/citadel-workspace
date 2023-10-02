use crate::structs::ConnectionState;
use citadel_workspace_types::InternalServiceRequest;
use futures::SinkExt;
use tauri::State;
use uuid::Uuid;

#[tauri::command]
pub async fn get_session(
    state: State<'_, ConnectionState>,
    _window: tauri::Window,
) -> Result<String, String> {
    let request_id = Uuid::new_v4();
    let payload = InternalServiceRequest::GetSessions { request_id };
    if state
        .sink
        .lock()
        .await
        .as_mut()
        .unwrap()
        .send(bincode2::serialize(&payload).unwrap().into())
        .await
        .is_ok()
    {
        Ok(request_id.to_string())
    } else {
        Err("Unable to get_session".to_string())
    }
}
