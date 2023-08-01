use crate::structs::ConnectionState;
use citadel_workspace_types::InternalServiceRequest::PeerDisconnect;
use futures::SinkExt;
use tauri::State;
use uuid::Uuid;

#[tauri::command]
pub async fn peer_disconnect(
    uuid: String,
    cid: u64,
    peer_cid: u64,
    state: State<'_, ConnectionState>,
) -> Result<(), String> {
    let uuid = Uuid::parse_str(&uuid).unwrap();
    let payload = PeerDisconnect {
        uuid,
        cid,
        peer_cid,
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
