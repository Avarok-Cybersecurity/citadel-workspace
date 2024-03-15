use crate::{commands::send_to_internal_service, structs::ConnectionState};
use citadel_internal_service_types::InternalServiceRequest::LocalDBGetAllKV;
use tauri::State;
use uuid::Uuid;

#[tauri::command]
pub async fn local_db_get_all_kv(
    cid: String,
    peer_cid: Option<String>,
    state: State<'_, ConnectionState>,
) -> Result<String, String> {
    let request_id = Uuid::new_v4();
    let payload = LocalDBGetAllKV {
        request_id,
        cid: cid.parse::<u64>().unwrap(),
        peer_cid: peer_cid.map(|pid| pid.parse::<u64>().unwrap()),
    };

    send_to_internal_service(payload, state).await?;
    Ok(request_id.to_string())
}
