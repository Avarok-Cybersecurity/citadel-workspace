use crate::types::{
    string_to_u64, PeerDisconnectFailureTS, PeerDisconnectRequestTS, PeerDisconnectSuccessTS,
};
use citadel_internal_service_types::{
    InternalServiceRequest::PeerDisconnect, InternalServiceResponse,
};
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
    let cid = string_to_u64(&request.cid);
    let peer_cid = string_to_u64(&request.peer_cid);

    let payload = PeerDisconnect {
        request_id,
        cid,
        peer_cid,
    };

    let response = send_and_recv(payload, request_id, &state).await;

    match response {
        InternalServiceResponse::PeerDisconnectSuccess(success) => {
            println!("Peer disconnection successful");
            Ok(PeerDisconnectSuccessTS {
                cid: success.cid.to_string(),
                request_id: success.request_id.map(|id| id.to_string()),
            })
        }
        InternalServiceResponse::PeerDisconnectFailure(err) => {
            println!("Peer disconnection failure: {:#?}", err);
            Err(PeerDisconnectFailureTS {
                cid: err.cid.to_string(),
                message: err.message,
                request_id: err.request_id.map(|id| id.to_string()),
            })
        }
        other => {
            let error_msg = format!(
                "Internal service returned unexpected type '{}' during peer disconnection",
                std::any::type_name_of_val(&other)
            );
            println!("{}", error_msg);
            Err(PeerDisconnectFailureTS {
                cid: cid.to_string(),
                message: error_msg,
                request_id: Some(request_id.to_string()),
            })
        }
    }
}
