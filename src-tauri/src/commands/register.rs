use crate::{structs::ConnectionState, ADDR};
use citadel_workspace_types::InternalServicePayload;
use futures::SinkExt;
use tauri::State;
use uuid::Uuid;

#[tauri::command]
pub async fn register(
    uuid: String,
    full_name: String,
    username: String,
    proposed_password: String,
    state: State<'_, ConnectionState>,
) -> Result<(), String> {
    let uuid = Uuid::parse_str(&uuid).unwrap();
    let payload = InternalServicePayload::Register {
        uuid,
        server_addr: ADDR,
        full_name,
        username,
        proposed_password: proposed_password.into_bytes().into(),
        connect_after_register: Default::default(),
        default_security_settings: Default::default(),
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
