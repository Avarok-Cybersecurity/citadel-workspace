use crate::structs::ConnectionState;
use citadel_internal_service_types::InternalServiceRequest::Disconnect;
use futures::SinkExt;
use tauri::State;

#[tauri::command]
pub async fn disconnect(
    cid: u64,
    request_id: String,
    state: State<'_, ConnectionState>,
) -> Result<String, String> {
    let payload = Disconnect {
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
