use citadel_internal_service_types::InternalServiceRequest;
use futures::SinkExt;
use std::net::SocketAddr;
use std::str::FromStr;
use tauri::State;
use uuid::Uuid;

use crate::structs::ConnectionState;

#[tauri::command]
pub async fn register(
    full_name: String,
    username: String,
    proposed_password: String,
    server_addr: String,
    _window: tauri::Window,
    state: State<'_, ConnectionState>,
) -> Result<String, String> {
    let server_addr = SocketAddr::from_str(&server_addr).map_err(|_| "Invalid server address")?;
    let request_id = Uuid::new_v4();
    let payload = InternalServiceRequest::Register {
        request_id,
        server_addr,
        full_name,
        username: username.clone(),
        proposed_password: proposed_password.into_bytes().into(),
        connect_after_register: true,
        session_security_settings: Default::default(),
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
