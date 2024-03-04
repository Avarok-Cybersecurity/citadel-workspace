use crate::commands::send_to_internal_service;
use crate::structs::ConnectionState;
use citadel_internal_service_types::InternalServiceRequest::Message;
use tauri::State;

#[tauri::command]
pub async fn message(
    message: String,
    cid: u64,
    peer_cid: Option<u64>,
    request_id: String,
    state: State<'_, ConnectionState>,
) -> Result<String, String> {
    let request = Message {
        message: message.into_bytes(),
        cid,
        peer_cid,
        security_level: Default::default(),
        request_id: request_id.parse().unwrap(),
    };

    send_to_internal_service(request, state).await?;
    Ok(request_id)
}
