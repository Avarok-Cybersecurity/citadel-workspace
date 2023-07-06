use citadel_workspace_types::InternalServicePayload;
use futures::SinkExt;
use tauri::State;
use uuid::Uuid;

use crate::structs::ConnectionState;

#[tauri::command]
pub async fn send_file(
    uuid: String,
    cid: u64,
    peer_id: u64,
    source: String,
    chunk_size: u64,
    transfer_type: String,
    state: State<'_, ConnectionState>,
) -> Result<(), String> {
    let uuid = Uuid::parse_str(&uuid).unwrap();
    let payload = InternalServicePayload::SendFile {
        uuid,
        source: source.into_bytes(),
        cid,
        chunk_size: chunk_size as usize,
        transfer_type: transfer_type.into(),
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
