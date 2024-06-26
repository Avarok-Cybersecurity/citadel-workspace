use crate::commands::send_to_internal_service;
use citadel_internal_service_types::InternalServiceRequest::ListRegisteredPeers;
use tauri::State;
use uuid::Uuid;

use crate::structs::ConnectionState;

#[tauri::command]
pub async fn list_registered_peers(
    cid: String,
    state: State<'_, ConnectionState>,
) -> Result<String, String> {
    let request_id = Uuid::new_v4();
    let request = ListRegisteredPeers {
        request_id,
        cid: cid.parse().unwrap(),
    };

    send_to_internal_service(request, state).await?;
    Ok(request_id.to_string())
}
