use crate::commands::send_to_internal_service;
use citadel_internal_service_types::InternalServiceRequest::Connect;
use tauri::State;

use crate::structs::ConnectionState;

#[tauri::command]
pub async fn connect(
    username: String,
    password: String,
    request_id: String,
    state: State<'_, ConnectionState>,
) -> Result<String, String> {
    let request = Connect {
        username,
        password: password.into_bytes().into(),
        connect_mode: Default::default(),
        udp_mode: Default::default(),
        keep_alive_timeout: Default::default(),
        session_security_settings: Default::default(),
        request_id: request_id.parse().unwrap(),
        server_password: None,
    };

    send_to_internal_service(request, state).await?;
    Ok(request_id)
}
