use citadel_workspace_types::InternalServicePayload;
use futures::SinkExt;
use tauri::State;
use uuid::Uuid;

use crate::structs::ConnectionState;

#[tauri::command]
pub async fn connect(
    uuid: String,
    username: String,
    password: String,
    state: State<'_, ConnectionState>,
) -> Result<(), String> {
    let uuid = Uuid::parse_str(&uuid).unwrap();
    let payload = InternalServicePayload::Connect {
        uuid,
        username,
        password: password.into_bytes().into(),
        connect_mode: Default::default(),
        udp_mode: Default::default(),
        keep_alive_timeout: Default::default(),
        session_security_settings: Default::default(),
    };
    let _ = state
        .sink
        .lock()
        .await
        .as_mut()
        .unwrap()
        .send(bincode2::serialize(&payload).unwrap().into())
        .await;

    Ok(())
}
