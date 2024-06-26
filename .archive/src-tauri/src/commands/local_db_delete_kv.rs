use crate::commands::send_to_internal_service;
use citadel_internal_service_types::InternalServiceRequest::LocalDBDeleteKV;
use tauri::State;
use uuid::Uuid;

use crate::structs::ConnectionState;

#[tauri::command]
pub async fn local_db_delete_kv(
    cid: String,
    peer_cid: Option<String>,
    key: String,
    state: State<'_, ConnectionState>,
) -> Result<String, String> {
    let request_id = Uuid::new_v4();
    let payload = LocalDBDeleteKV {
        request_id,
        cid: cid.parse::<u64>().unwrap(),
        peer_cid: peer_cid.map(|pid| pid.parse::<u64>().unwrap()),
        key,
    };

    send_to_internal_service(payload, state).await?;
    Ok(request_id.to_string())
}
