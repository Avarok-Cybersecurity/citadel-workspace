use crate::structs::ConnectionState;
use citadel_workspace_types::InternalServiceRequest;
use futures::SinkExt;
use std::net::SocketAddr;
use std::str::FromStr;
use tauri::State;
use uuid::Uuid;

#[tauri::command]
pub async fn register(
    uuid: String,
    full_name: String,
    username: String,
    proposed_password: String,
    server_addr: String,
    state: State<'_, ConnectionState>,
    _window: tauri::Window,
) -> Result<String, String> {
    let server_addr = SocketAddr::from_str(&server_addr).map_err(|_| "Invalid server address")?;
    let request_id = Uuid::new_v4();
    match Uuid::parse_str(&uuid) {
        Ok(uuid) => {
            let payload = InternalServiceRequest::Register {
                uuid,
                server_addr,
                full_name,
                username: username.clone(),
                proposed_password: proposed_password.into_bytes().into(),
                connect_after_register: false,
                default_security_settings: Default::default(),
                request_id,
            };
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
                Err("Unable to register".to_string())
            }
        }
        Err(_) => return Err("Invalid UUID".to_string()),
    }
}
