use citadel_internal_service_types::InternalServiceRequest::PeerConnect;
use futures::SinkExt;
use tauri::State;
use uuid::Uuid;

use crate::structs::ConnectionState;

#[tauri::command]
pub async fn peer_connect(
    cid: String,
    peer_cid: String,
    state: State<'_, ConnectionState>,
) -> Result<(), String> {
    let request_id = Uuid::new_v4();
    let payload = PeerConnect {
        request_id,
        cid: cid.parse::<u64>().unwrap(),
        peer_cid: peer_cid.parse::<u64>().unwrap(),
        udp_mode: Default::default(),
        session_security_settings: Default::default(),
    };

    let _ = state
        .sink
        .lock()
        .await
        .as_mut()
        .unwrap()
        .send(payload)
        .await;

    Ok(())
}
