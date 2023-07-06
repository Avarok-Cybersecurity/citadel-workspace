use citadel_workspace_types::{InternalServicePayload, TransferType};
use futures::SinkExt;
use std::path::PathBuf;
use tauri::State;
use uuid::Uuid;

use crate::structs::ConnectionState;

#[tauri::command]
pub async fn send_file(
    uuid: String,
    cid: u64,
    source: String,
    chunk_size: u64,
    state: State<'_, ConnectionState>,
) -> Result<(), String> {
    let uuid = Uuid::parse_str(&uuid).unwrap();
    let payload = InternalServicePayload::SendFile {
        uuid,
        source: PathBuf::from(source),
        cid,
        chunk_size: chunk_size as usize,
        transfer_type: TransferType::FileTransfer,
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
