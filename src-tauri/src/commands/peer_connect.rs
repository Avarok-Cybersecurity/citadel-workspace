use crate::types::{
    string_to_u64, PeerConnectFailureTS, PeerConnectRequestTS, PeerConnectSuccessTS,
};
use citadel_internal_service_types::{
    InternalServiceRequest::PeerConnect, InternalServiceResponse,
};
use log::error;
use tauri::State;
use uuid::Uuid;

use crate::state::WorkspaceState;

use super::send_and_recv;

#[tauri::command]
pub async fn peer_connect(
    request: PeerConnectRequestTS,
    state: State<'_, WorkspaceState>,
) -> Result<PeerConnectSuccessTS, PeerConnectFailureTS> {
    let request_id = Uuid::new_v4();

    // Parse cid and peer_cid using our helper function
    let original_cid_str = request.cid.clone(); // Clone for potential error reporting
    let original_peer_cid_str = request.peer_cid.clone(); // Clone for potential error reporting

    let cid = string_to_u64(&request.cid).map_err(|e| PeerConnectFailureTS {
        cid: original_cid_str.clone(),
        peer_cid: Some(original_peer_cid_str.clone()),
        message: format!("Invalid CID: {}", e),
        request_id: Some(request_id.to_string()),
    })?;

    let peer_cid = string_to_u64(&request.peer_cid).map_err(|e| PeerConnectFailureTS {
        cid: original_cid_str.clone(),
        peer_cid: Some(original_peer_cid_str.clone()),
        message: format!("Invalid Peer CID: {}", e),
        request_id: Some(request_id.to_string()),
    })?;

    let payload = PeerConnect {
        request_id,
        cid,
        peer_cid,
        udp_mode: Default::default(),
        session_security_settings: Default::default(),
        peer_session_password: None,
    };

    let response = send_and_recv(payload, request_id, &state).await;

    match response {
        InternalServiceResponse::PeerConnectSuccess(r) => Ok(PeerConnectSuccessTS {
            cid: r.cid.to_string(),
            peer_cid: r.peer_cid.to_string(),
            request_id: r.request_id.map(|id| id.to_string()),
        }),
        InternalServiceResponse::PeerConnectFailure(failure) => {
            error!(target: "citadel", "Failed to connect to peer with cid {}: {}", request.peer_cid, failure.message);
            Err(PeerConnectFailureTS {
                cid: failure.cid.to_string(),
                peer_cid: Some(request.peer_cid.to_string()),
                message: failure.message,
                request_id: failure.request_id.map(|id| id.to_string()),
            })
        }
        other => {
            error!(target: "citadel", "Unexpected response type in peer_connect: {:?}", other);
            Err(PeerConnectFailureTS {
                cid: cid.to_string(),
                peer_cid: Some(peer_cid.to_string()),
                message: "Internal Error: Unexpected response type".to_string(),
                request_id: other.request_id().map(|id| id.to_string()),
            })
        }
    }
}
