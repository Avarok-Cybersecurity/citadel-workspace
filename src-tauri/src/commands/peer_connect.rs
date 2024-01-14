use citadel_workspace_types::InternalServicePayload;
use futures::SinkExt;
use tauri::State;
use uuid::Uuid;

use crate::structs::ConnectionState;

#[tauri::command]
pub async fn peer_connect(
    uuid: String,
    cid: u64,
    username: String,
    peer_cid: u64,
    peer_username: String,
    state: State<'_, ConnectionState>,
) -> Result<(), String> {
    let uuid = Uuid::parse_str(&uuid).unwrap();
    let payload = InternalServicePayload::PeerConnect {
        uuid,
        cid,
        username,
        peer_cid,
        peer_username,
        udp_mode: Default::default(),
        session_security_settings: Default::default(),
    };

    let _ = state
        .sink
        .lock()
        .await
        .as_mut()
        .unwrap()
        .send(bincode2::serialize(&payload).unwrap().into())
        .await;

    Ok(())
}
