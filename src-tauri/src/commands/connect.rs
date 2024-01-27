use citadel_internal_service_types::InternalServiceRequest::Connect;
use futures::SinkExt;
use tauri::State;

use crate::structs::ConnectionState;

#[tauri::command]
pub async fn connect(
    username: String,
    password: String,
    request_id: String,
    state: State<'_, ConnectionState>,
) -> Result<String, String> {
    let payload = Connect {
        username,
        password: password.into_bytes().into(),
        connect_mode: Default::default(),
        udp_mode: Default::default(),
        keep_alive_timeout: Default::default(),
        session_security_settings: Default::default(),
        request_id: request_id.parse().unwrap(),
    };
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
        Err("Unable to connect".to_string())
    }
}
