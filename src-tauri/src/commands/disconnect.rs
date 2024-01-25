use crate::structs::ConnectionState;
use citadel_internal_service_types::InternalServiceRequest::Disconnect;
use futures::SinkExt;
use tauri::State;
use uuid::Uuid;

#[tauri::command]
pub async fn disconnect(cid: String, state: State<'_, ConnectionState>) -> Result<String, String> {
    let request_id = Uuid::new_v4();
    let payload = Disconnect {
        cid: cid.parse().unwrap(),
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
        Err("Unable to disconnect".to_string())
    }
}
