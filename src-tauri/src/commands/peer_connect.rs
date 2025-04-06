use crate::types::{
    string_to_u64, PeerConnectFailureTS, PeerConnectRequestTS, PeerConnectSuccessTS,
};
use citadel_internal_service_types::{
    InternalServiceRequest::PeerConnect, InternalServiceResponse,
};
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
    let cid = string_to_u64(&request.cid);
    let peer_cid = string_to_u64(&request.peer_cid);

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
        InternalServiceResponse::PeerConnectFailure(r) => {
            println!("Peer connect failed: {}", r.message);
            Err(PeerConnectFailureTS {
                cid: r.cid.to_string(),
                message: r.message,
                request_id: r.request_id.map(|id| id.to_string()),
            })
        }
        other => {
            let error_msg = format!(
                "Internal service returned unexpected type '{}' during peer connection",
                std::any::type_name_of_val(&other)
            );
            println!("{}", error_msg);
            Err(PeerConnectFailureTS {
                cid: cid.to_string(),
                message: error_msg,
                request_id: Some(request_id.to_string()),
            })
        }
    }
}
