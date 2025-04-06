use crate::state::WorkspaceState;
use crate::types::{
    string_to_u64, PeerRegisterFailureTS, PeerRegisterRequestTS, PeerRegisterSuccessTS,
};
use citadel_internal_service_types::{InternalServiceRequest, InternalServiceResponse};
use tauri::State;
use uuid::Uuid;

use super::send_and_recv;

#[tauri::command]
pub async fn peer_register(
    request: PeerRegisterRequestTS,
    state: State<'_, WorkspaceState>,
) -> Result<PeerRegisterSuccessTS, PeerRegisterFailureTS> {
    let request_id = Uuid::new_v4();

    // Convert string CID to u64
    let cid = string_to_u64(&request.cid);
    let peer_cid = string_to_u64(&request.peer_cid);

    // Using the correct field structure for PeerRegister
    let payload = InternalServiceRequest::PeerRegister {
        cid,
        peer_cid,
        request_id,
        // Add the missing required fields
        peer_session_password: None,
        connect_after_register: false,
        session_security_settings: Default::default(),
    };

    let response = send_and_recv(payload, request_id, &state).await;

    match response {
        InternalServiceResponse::PeerRegisterSuccess(success) => {
            // Only include the fields that exist in PeerRegisterSuccessTS
            Ok(PeerRegisterSuccessTS {
                request_id: success.request_id.map(|id| id.to_string()),
            })
        }
        InternalServiceResponse::PeerRegisterFailure(err) => {
            println!("Peer register failed: {}", err.message);
            Err(PeerRegisterFailureTS {
                message: err.message,
                request_id: err.request_id.map(|id| id.to_string()),
            })
        }
        other => {
            let error_msg = format!(
                "Internal service returned unexpected type '{}' during peer registration",
                std::any::type_name_of_val(&other)
            );
            println!("{}", error_msg);
            Err(PeerRegisterFailureTS {
                message: error_msg,
                request_id: Some(request_id.to_string()),
            })
        }
    }
}
