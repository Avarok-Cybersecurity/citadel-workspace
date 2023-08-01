use crate::{send_response, structs::ConnectionState};
use citadel_workspace_types::InternalServiceRequest::GetSessions;
use futures::SinkExt;
use tauri::State;
use uuid::Uuid;

#[tauri::command]
pub async fn get_session(
    uuid: String,
    request_id: String,
    state: State<'_, ConnectionState>,
    window: tauri::Window,
) -> Result<(), String> {
    match Uuid::parse_str(&uuid) {
        Ok(uuid) => {
            if let Ok(req_id) = Uuid::parse_str(&request_id) {
                let payload = GetSessions {
                    uuid,
                    request_id: req_id,
                };
                if let Ok(_) = state
                    .sink
                    .lock()
                    .await
                    .as_mut()
                    .unwrap()
                    .send(bincode2::serialize(&payload).unwrap().into())
                    .await
                {
                    let _ = send_response("register", "Registerd".into(), window).await;
                    Ok(())
                } else {
                    Err("Unable to register".to_string())
                }
            } else {
                Err("Invalid request ID".to_string())
            }
        }
        Err(_) => return Err("Invalid UUID".to_string()),
    }
}
