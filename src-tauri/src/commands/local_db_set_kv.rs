use crate::state::WorkspaceState;
use crate::types::{
    string_to_u64, LocalDBSetKVFailureTS, LocalDBSetKVRequestTS, LocalDBSetKVSuccessTS,
};
use citadel_internal_service_types::{InternalServiceRequest, InternalServiceResponse};
use tauri::State;
use uuid::Uuid;

use super::send_and_recv;

#[tauri::command]
pub async fn local_db_set_kv(
    request: LocalDBSetKVRequestTS,
    state: State<'_, WorkspaceState>,
) -> Result<LocalDBSetKVSuccessTS, LocalDBSetKVFailureTS> {
    let request_id = Uuid::new_v4();

    // Convert CIDs from string to u64
    let cid = string_to_u64(&request.cid).map_err(|e| LocalDBSetKVFailureTS {
        cid: request.cid.clone(),
        peer_cid: request.peer_cid.clone(),
        message: e,
        request_id: Some(request_id.to_string()),
    })?;

    let peer_cid = request
        .peer_cid
        .as_ref()
        .map(|pc_str| string_to_u64(pc_str))
        .transpose()
        .map_err(|e| LocalDBSetKVFailureTS {
            cid: request.cid.clone(),
            peer_cid: request.peer_cid.clone(),
            message: e,
            request_id: Some(request_id.to_string()),
        })?;

    // Prepare the internal service request
    let payload = InternalServiceRequest::LocalDBSetKV {
        cid,
        peer_cid,
        request_id,
        key: request.key.clone(),
        // Convert String to Vec<u8> using into()
        value: request.value.clone().into(),
    };

    let response = send_and_recv(payload, request_id, &state).await;

    match response {
        InternalServiceResponse::LocalDBSetKVSuccess(success) => {
            println!("Local DB set KV successful");
            Ok(LocalDBSetKVSuccessTS {
                request_id: success.request_id.map(|id| id.to_string()),
                cid: success.cid.to_string(),
                peer_cid: success.peer_cid.map(|id| id.to_string()),
                key: success.key, // Add the missing key field
            })
        }
        InternalServiceResponse::LocalDBSetKVFailure(err) => {
            println!("Local DB set KV failed: {}", err.message);
            Err(LocalDBSetKVFailureTS {
                request_id: err.request_id.map(|id| id.to_string()),
                message: err.message,
                cid: err.cid.to_string(),
                peer_cid: err.peer_cid.map(|id| id.to_string()),
            })
        }
        other => {
            let error_msg = format!(
                "Internal service returned unexpected type '{}' during local DB set KV",
                std::any::type_name_of_val(&other)
            );
            println!("{}", error_msg);
            Err(LocalDBSetKVFailureTS {
                request_id: Some(request_id.to_string()),
                message: error_msg,
                cid: cid.to_string(),
                peer_cid: peer_cid.map(|id| id.to_string()),
            })
        }
    }
}
