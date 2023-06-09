use citadel_workspace_types::InternalServicePayload;
use futures::SinkExt;
use tauri::State;
use uuid::Uuid;

use crate::structs::ConnectionState;

#[tauri::command]
pub async fn peer_redister(
    uuid: String,
    cid: u64,
    peer_id: u64,
    state: State<'_, ConnectionState>,
) -> Result<(), String> {
    let uuid = Uuid::parse_str(&uuid).unwrap();
    let payload = InternalServicePayload::PeerRegister {
        uuid,
        cid,
        connect_after_register: false,
        peer_id: peer_id.into(),
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
