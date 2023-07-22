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
) -> Result<String, String> {
    match Uuid::parse_str(&uuid) {
        Ok(uuid) => {
            let payload = InternalServicePayload::Register {
                uuid,
                server_addr: ADDR,
                full_name,
                username: username.clone(),
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

            Ok(format!("Registerd as {}", username.clone()))
        }
        Err(_) => return Err("Invalid UUID".to_string()),
    }
}
