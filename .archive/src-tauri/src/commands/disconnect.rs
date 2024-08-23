use crate::commands::send_to_internal_service;
use citadel_internal_service_types::InternalServiceRequest::Disconnect;
use tauri::State;
use uuid::Uuid;

use crate::structs::ConnectionState;

#[tauri::command]
pub async fn disconnect(cid: String, state: State<'_, ConnectionState>) -> Result<String, String> {
    let request_id = Uuid::new_v4();
    let request = Disconnect {
        cid: cid.parse().unwrap(),
        request_id,
    };

    send_to_internal_service(request, state).await?;
    Ok(request_id.to_string())
}
