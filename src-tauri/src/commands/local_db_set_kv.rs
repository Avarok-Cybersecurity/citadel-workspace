use citadel_internal_service_types::InternalServiceRequest::LocalDBSetKV;
use tauri::State;
use uuid::Uuid;

use crate::structs::ConnectionState;

#[tauri::command]
pub async fn local_db_set_kv(
    cid: String,
    peer_cid: Option<String>,
    key: String,
    value: Vec<u8>,
    state: State<'_, ConnectionState>,
) -> Result<String, String> {
    let request_id = Uuid::new_v4();
    let payload = LocalDBSetKV {
        request_id,
        cid: cid.parse::<u64>().unwrap(),
        peer_cid: peer_cid.map(|pid| pid.parse::<u64>().unwrap()),
        key,
        value,
    };


    Ok(request_id.to_string())
}
