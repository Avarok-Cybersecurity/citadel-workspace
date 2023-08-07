use crate::structs::ConnectionState;
use citadel_workspace_types::InternalServiceRequest::Disconnect;
use futures::SinkExt;
use tauri::State;
use uuid::Uuid;

#[tauri::command]
pub async fn disconnect(
    uuid: String,
    cid: u64,
    request_id: String,
    state: State<'_, ConnectionState>,
) -> Result<String, String> {
    match Uuid::parse_str(&uuid) {
        Ok(uuid) => {
            let payload = Disconnect {
                uuid,
                cid,
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
                Err("Unable to disconnect".to_string())
            }
        }
        Err(_) => return Err("Invalid UUID".to_string()),
    }
}
