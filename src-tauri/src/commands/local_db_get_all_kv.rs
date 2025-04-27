use crate::state::WorkspaceState;
use crate::types::{
    string_to_u64, KVPairTS, LocalDBGetAllKVFailureTS, LocalDBGetAllKVRequestTS,
    LocalDBGetAllKVSuccessTS,
};
use citadel_internal_service_types::{InternalServiceRequest, InternalServiceResponse};
use std::string::String as StdString;
use tauri::State;
use uuid::Uuid;

use super::send_and_recv;

#[tauri::command]
pub async fn local_db_get_all_kv(
    request: LocalDBGetAllKVRequestTS,
    state: State<'_, WorkspaceState>,
) -> Result<LocalDBGetAllKVSuccessTS, LocalDBGetAllKVFailureTS> {
    let request_id = Uuid::new_v4();

    // Convert string CID to u64
    let cid = string_to_u64(&request.cid).map_err(|err_msg| LocalDBGetAllKVFailureTS {
        message: err_msg,
        request_id: Some(request_id.to_string()),
    })?;
    let peer_cid = request
        .peer_cid
        .as_ref()
        .map(|s| string_to_u64(s))
        .transpose()
        .map_err(|err_msg| LocalDBGetAllKVFailureTS {
            message: err_msg,
            request_id: Some(request_id.to_string()),
        })?;

    let payload = InternalServiceRequest::LocalDBGetAllKV {
        cid,
        peer_cid,
        request_id,
    };

    let response = send_and_recv(payload, request_id, &state).await;

    match response {
        InternalServiceResponse::LocalDBGetAllKVSuccess(success) => {
            println!("Local DB get all KV successful");

            // Convert the key-value pairs to the TypeScript-friendly format
            // The map field contains the key-value pairs in the actual response type
            let pairs: Vec<KVPairTS> = success
                .map
                .into_iter()
                .map(|(key, value)| {
                    // Convert Vec<u8> to String
                    let value_str = match StdString::from_utf8(value) {
                        Ok(s) => s,
                        Err(_) => "Invalid UTF-8 data".to_string(),
                    };
                    KVPairTS {
                        key,
                        value: value_str,
                    }
                })
                .collect();

            Ok(LocalDBGetAllKVSuccessTS {
                request_id: success.request_id.map(|id| id.to_string()),
                pairs,
            })
        }
        InternalServiceResponse::LocalDBGetAllKVFailure(err) => {
            println!("Local DB get all KV failed: {}", err.message);
            Err(LocalDBGetAllKVFailureTS {
                request_id: err.request_id.map(|id| id.to_string()),
                message: err.message,
            })
        }
        other => {
            let error_msg = format!(
                "Internal service returned unexpected type '{}' during local DB get all KV",
                std::any::type_name_of_val(&other)
            );
            println!("{}", error_msg);
            Err(LocalDBGetAllKVFailureTS {
                request_id: Some(request_id.to_string()),
                message: error_msg,
            })
        }
    }
}
