use crate::state::WorkspaceState;
use crate::types::{
    string_to_u64, LocalDBGetKVFailureTS, LocalDBGetKVRequestTS, LocalDBGetKVSuccessTS,
};
use citadel_internal_service_types::{InternalServiceRequest, InternalServiceResponse};
use tauri::State;
use uuid::Uuid;

use super::send_and_recv;

#[tauri::command]
pub async fn local_db_get_kv(
    request: LocalDBGetKVRequestTS,
    state: State<'_, WorkspaceState>,
) -> Result<LocalDBGetKVSuccessTS, LocalDBGetKVFailureTS> {
    let request_id = Uuid::new_v4();

    // Store original strings for potential error reporting
    let original_cid_str = request.cid.clone();
    let original_peer_cid_str = request.peer_cid.clone();

    // Convert CIDs from string to u64
    let cid = string_to_u64(&request.cid).map_err(|e| LocalDBGetKVFailureTS {
        cid: original_cid_str.clone(),
        peer_cid: original_peer_cid_str.clone(),
        message: e,
        request_id: Some(request_id.to_string()),
    })?;

    let peer_cid = request
        .peer_cid
        .as_deref()
        .map(string_to_u64)
        .transpose()
        .map_err(|e| LocalDBGetKVFailureTS {
            cid: original_cid_str.clone(),
            peer_cid: original_peer_cid_str.clone(),
            message: e,
            request_id: Some(request_id.to_string()),
        })?;

    // Prepare the internal service request
    let payload = InternalServiceRequest::LocalDBGetKV {
        cid,
        peer_cid,
        request_id,
        key: request.key.clone(),
    };

    let response = send_and_recv(payload, request_id, &state).await;

    match response {
        InternalServiceResponse::LocalDBGetKVSuccess(success) => {
            println!("Local DB get KV successful");
            Ok(LocalDBGetKVSuccessTS {
                request_id: success.request_id.map(|id| id.to_string()),
                cid: success.cid.to_string(),
                peer_cid: success.peer_cid.map(|id| id.to_string()),
                key: success.key,
                value: success.value,
            })
        }
        InternalServiceResponse::LocalDBGetKVFailure(err) => {
            println!("Local DB get KV failed: {}", err.message);
            Err(LocalDBGetKVFailureTS {
                request_id: err.request_id.map(|id| id.to_string()),
                message: err.message,
                cid: err.cid.to_string(),
                peer_cid: err.peer_cid.map(|id| id.to_string()),
            })
        }
        other => {
            let error_msg = format!(
                "Internal service returned unexpected type '{}' during local DB get KV",
                std::any::type_name_of_val(&other)
            );
            println!("{}", error_msg);
            Err(LocalDBGetKVFailureTS {
                request_id: Some(request_id.to_string()),
                message: error_msg,
                cid: original_cid_str, // Use original request string
                peer_cid: original_peer_cid_str, // Use original request string
            })
        }
    }
}
