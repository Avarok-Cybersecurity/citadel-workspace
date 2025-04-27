use crate::state::WorkspaceState;
use crate::types::{
    string_to_u64, LocalDBDeleteKVFailureTS, LocalDBDeleteKVRequestTS, LocalDBDeleteKVSuccessTS,
};
use citadel_internal_service_types::{InternalServiceRequest, InternalServiceResponse};
use tauri::State;
use uuid::Uuid;

use super::send_and_recv;

#[tauri::command]
pub async fn local_db_delete_kv(
    request: LocalDBDeleteKVRequestTS,
    state: State<'_, WorkspaceState>,
) -> Result<LocalDBDeleteKVSuccessTS, LocalDBDeleteKVFailureTS> {
    let request_id = Uuid::new_v4();

    // Convert string CID to u64
    let cid = string_to_u64(&request.cid).map_err(|err_msg| LocalDBDeleteKVFailureTS {
        message: err_msg,
        request_id: Some(request_id.to_string()),
    })?;
    let peer_cid = request
        .peer_cid
        .as_ref()
        .map(|s| {
            string_to_u64(s).map_err(|err_msg| LocalDBDeleteKVFailureTS {
                message: err_msg,
                request_id: Some(request_id.to_string()),
            })
        })
        .transpose()?;

    let payload = InternalServiceRequest::LocalDBDeleteKV {
        cid,
        peer_cid,
        request_id,
        key: request.key.clone(),
    };

    let response = send_and_recv(payload, request_id, &state).await;

    match response {
        InternalServiceResponse::LocalDBDeleteKVSuccess(success) => {
            println!("Local DB delete KV successful");
            Ok(LocalDBDeleteKVSuccessTS {
                request_id: success.request_id.map(|id| id.to_string()),
            })
        }
        InternalServiceResponse::LocalDBDeleteKVFailure(err) => {
            println!("Local DB delete KV failed: {}", err.message);
            Err(LocalDBDeleteKVFailureTS {
                request_id: err.request_id.map(|id| id.to_string()),
                message: err.message,
            })
        }
        other => {
            let error_msg = format!(
                "Internal service returned unexpected type '{}' during local DB delete KV",
                std::any::type_name_of_val(&other)
            );
            println!("{}", error_msg);
            Err(LocalDBDeleteKVFailureTS {
                request_id: Some(request_id.to_string()),
                message: error_msg,
            })
        }
    }
}
