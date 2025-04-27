use crate::state::WorkspaceState;
use crate::types::{PeerRegisterFailureTS, PeerRegisterRequestTS, PeerRegisterSuccessTS};
use citadel_internal_service_types::{InternalServiceRequest, InternalServiceResponse};
use log::error;
use log::info;
use tauri::State;
use uuid::Uuid;

use super::send_and_recv;

#[tauri::command]
pub async fn peer_register(
    request: PeerRegisterRequestTS,
    state: State<'_, WorkspaceState>,
) -> Result<PeerRegisterSuccessTS, PeerRegisterFailureTS> {
    let request_id = Uuid::new_v4();
    let _original_cid_str = request.cid.clone(); // Clone cid for potential error reporting
    let original_peer_cid = request.peer_cid.clone(); // Clone peer_cid before request is moved

    // Convert TS request to internal request, mapping potential String error
    let internal_request: InternalServiceRequest =
        request.try_into().map_err(|e| PeerRegisterFailureTS {
            message: format!("Failed to convert PeerRegisterRequestTS: {}", e),
            request_id: Some(request_id.to_string()),
        })?;

    // Send request and receive response
    let response = send_and_recv(internal_request, request_id, &state).await;

    match response {
        InternalServiceResponse::PeerRegisterSuccess(success) => {
            info!(target: "citadel", "PeerRegisterSuccess: CID={}, Implicated CID={:?}", success.cid, success.peer_cid);
            // Construct the TS success response
            Ok(PeerRegisterSuccessTS {
                cid: success.cid.to_string(), // cid is u64
                // Assuming peer_cid is u64 based on compiler error, convert to String and wrap in Some
                implicated_cid: Some(success.peer_cid.to_string()),
                // request_id is Option<Uuid>, use Option::map
                request_id: success.request_id.map(|id_val| id_val.to_string()),
            })
        }
        InternalServiceResponse::PeerRegisterFailure(failure) => {
            error!(
                target: "citadel",
                "Peer register failure for request {}: CID={}, PeerCID={}, Message: {}",
                request_id,
                failure.cid,
                original_peer_cid,
                failure.message
            );
            // Construct the TS failure response
            Err(PeerRegisterFailureTS {
                message: failure.message,
                request_id: failure.request_id.map(|id| id.to_string()),
            })
        }
        other => {
            // Handle unexpected response types
            error!(target: "citadel", "Unexpected response type in peer_register: {:?}", other);
            Err(PeerRegisterFailureTS {
                message: "Internal Error: Unexpected response type".to_string(),
                request_id: other.request_id().map(|id| id.to_string()), // Get request_id from 'other'
            })
        }
    }
}
