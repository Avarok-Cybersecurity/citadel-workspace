use crate::commands::send_to_internal_service;
use citadel_internal_service_types::InternalServiceRequest::PeerRegister;
use tauri::State;
use uuid::Uuid;

use crate::structs::ConnectionState;

#[tauri::command]
pub async fn peer_register(
    cid: String,
    peer_cid: String,
    state: State<'_, ConnectionState>,
) -> Result<String, String> {
    let request_id = Uuid::new_v4();
    let request = PeerRegister {
        request_id,
        cid: cid.parse::<u64>().unwrap(),
        connect_after_register: false,
        session_security_settings: Default::default(),
        peer_cid: peer_cid.parse::<u64>().unwrap(),
    };

    send_to_internal_service(request, state).await?;
    Ok(request_id.to_string())
}
