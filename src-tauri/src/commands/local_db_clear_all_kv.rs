use crate::state::WorkspaceState;
use crate::types::{
    string_to_u64, LocalDBClearAllKVFailureTS, LocalDBClearAllKVRequestTS,
    LocalDBClearAllKVSuccessTS,
};
use citadel_internal_service_types::{InternalServiceRequest, InternalServiceResponse};
use tauri::State;
use uuid::Uuid;

use super::send_and_recv;

#[tauri::command]
pub async fn local_db_clear_all_kv(
    request: LocalDBClearAllKVRequestTS,
    state: State<'_, WorkspaceState>,
) -> Result<LocalDBClearAllKVSuccessTS, LocalDBClearAllKVFailureTS> {
    let request_id = Uuid::new_v4();

    // Convert string CID to u64
    let cid = string_to_u64(&request.cid);
    let peer_cid = request.peer_cid.as_ref().map(|s| string_to_u64(s));

    let payload = InternalServiceRequest::LocalDBClearAllKV {
        cid,
        peer_cid,
        request_id,
    };

    let response = send_and_recv(payload, request_id, &state).await;

    match response {
        InternalServiceResponse::LocalDBClearAllKVSuccess(success) => {
            println!("Local DB clear all KV successful");
            Ok(LocalDBClearAllKVSuccessTS {
                request_id: success.request_id.map(|id| id.to_string()),
            })
        }
        InternalServiceResponse::LocalDBClearAllKVFailure(err) => {
            println!("Local DB clear all KV failed: {}", err.message);
            Err(LocalDBClearAllKVFailureTS {
                request_id: err.request_id.map(|id| id.to_string()),
                message: err.message,
            })
        }
        other => {
            let error_msg = format!(
                "Internal service returned unexpected type '{}' during local DB clear all KV",
                std::any::type_name_of_val(&other)
            );
            println!("{}", error_msg);
            Err(LocalDBClearAllKVFailureTS {
                request_id: Some(request_id.to_string()),
                message: error_msg,
            })
        }
    }
}
