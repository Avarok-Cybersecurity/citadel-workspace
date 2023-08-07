use citadel_workspace_types::InternalServiceRequest::Message;
use futures::SinkExt;
use tauri::State;
use uuid::Uuid;

use crate::structs::ConnectionState;

#[tauri::command]
pub async fn message(
    uuid: String,
    message: String,
    cid: u64,
    peer_cid: Option<u64>,
    request_id: String,
    state: State<'_, ConnectionState>,
) -> Result<String, String> {
    match Uuid::parse_str(&uuid) {
        Ok(uuid) => {
            let payload = Message {
                uuid,
                message: message.into_bytes(),
                cid,
                peer_cid,
                security_level: Default::default(),
                request_id: request_id.parse().unwrap(),
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
                return Err("Unable to message".to_string());
            }
        }
        Err(_) => return Err("Invalid UUID".to_string()),
    }
}
