use crate::structs::ConnectionState;
use citadel_workspace_types::InternalServiceRequest::PeerDisconnect;
use futures::SinkExt;
use tauri::State;
use uuid::Uuid;

#[tauri::command]
pub async fn peer_disconnect(
    cid: String,
    peer_cid: String,
    state: State<'_, ConnectionState>,
) -> Result<(), String> {
    let request_id = Uuid::new_v4();
    let payload = PeerDisconnect {
        request_id,
        cid: cid.parse::<u64>().unwrap(),
        peer_cid: peer_cid.parse::<u64>().unwrap(),
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
