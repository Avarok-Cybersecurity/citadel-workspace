use crate::types::{
    PeerDisconnectFailureTS, PeerDisconnectRequestTS, PeerDisconnectSuccessTS,
};
use citadel_internal_service_types::{
    InternalServiceRequest::PeerDisconnect, InternalServiceResponse,
};
use log::{info, error};
use tauri::State;
use uuid::Uuid;

use super::send_and_recv;
use crate::state::WorkspaceState;

#[tauri::command]
pub async fn peer_disconnect(
    request: PeerDisconnectRequestTS,
    state: State<'_, WorkspaceState>,
) -> Result<PeerDisconnectSuccessTS, PeerDisconnectFailureTS> {
    let request_id = Uuid::new_v4();

    // Convert the string cid and peer_cid to u64
    let cid = request.cid.parse::<u64>().map_err(|e| PeerDisconnectFailureTS {
        cid: request.cid.clone(), // Use original string if parse fails
        message: format!("Invalid CID format: {}", e),
        request_id: Some(request_id.to_string()),
    })?;
    let peer_cid = request.peer_cid.parse::<u64>().map_err(|e| PeerDisconnectFailureTS {
        cid: request.cid.clone(), // Use original string if parse fails
        message: format!("Invalid peer CID format: {}", e),
        request_id: Some(request_id.to_string()),
    })?;


    let payload = PeerDisconnect {
        request_id,
        cid, // Use parsed u64
        peer_cid, // Use parsed u64
    };

    let response = send_and_recv(payload, request_id, &state).await;

    match response {
        InternalServiceResponse::PeerDisconnectSuccess(success) => {
            info!(target: "citadel", "PeerDisconnectSuccess: {:?}", success);
            Ok(PeerDisconnectSuccessTS { 
                cid: success.cid.to_string(),
                request_id: success.request_id.map(|id| id.to_string()),
            })
        }
        InternalServiceResponse::PeerDisconnectFailure(failure) => {
            error!(target: "citadel", "PeerDisconnectFailure: {}", failure.message);
            Err(PeerDisconnectFailureTS { 
                cid: failure.cid.to_string(), // Convert u64 to string
                message: failure.message,
                request_id: failure.request_id.map(|id| id.to_string()),
            })
        }
        other => {
            let error_msg = format!(
                "Unexpected response type for PeerDisconnect: {:?}",
                other
            );
            error!(target: "citadel", "{}", error_msg);
            // Error case for unexpected response type
            return Err(PeerDisconnectFailureTS {
                cid: cid.to_string(), // Convert the parsed u64 cid back to string
                message: error_msg,
                request_id: Some(request_id.to_string()),
            });
        }
    }
}
