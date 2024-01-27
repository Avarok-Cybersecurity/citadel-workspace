use citadel_internal_service_types::InternalServiceRequest::Message;
use futures::SinkExt;
use tauri::State;

#[tauri::command]
pub async fn message(
    message: String,
    cid: u64,
    peer_cid: Option<u64>,
    request_id: String,
) -> Result<String, String> {
    let payload = Message {
        message: message.into_bytes(),
        cid,
        peer_cid,
        security_level: Default::default(),
        request_id: request_id.parse().unwrap(),
    };

    Ok(request_id.to_string())
}
