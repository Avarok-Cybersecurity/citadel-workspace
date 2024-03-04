use crate::commands::send_to_internal_service;
use citadel_internal_service_types::InternalServiceRequest::PeerConnect;
use tauri::State;
use uuid::Uuid;

use crate::structs::ConnectionState;

#[tauri::command]
pub async fn peer_connect(
    cid: String,
    peer_cid: String,
    state: State<'_, ConnectionState>,
) -> Result<String, String> {
    let request_id = Uuid::new_v4();
    let payload = PeerConnect {
        request_id,
        cid: cid.parse::<u64>().unwrap(),
        peer_cid: peer_cid.parse::<u64>().unwrap(),
        udp_mode: Default::default(),
        session_security_settings: Default::default(),
    };

    send_to_internal_service(payload, state).await?;
    Ok(request_id.to_string())
}
