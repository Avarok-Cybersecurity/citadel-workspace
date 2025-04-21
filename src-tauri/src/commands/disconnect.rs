use crate::types::{DisconnectFailureTS, DisconnectRequestTS, DisconnectSuccessTS};
use citadel_internal_service_types::{InternalServiceRequest::Disconnect, InternalServiceResponse};
use tauri::State;
use uuid::Uuid;

use super::send_and_recv;
use crate::state::WorkspaceState;

#[tauri::command]
pub async fn disconnect(
    request: DisconnectRequestTS,
    state: State<'_, WorkspaceState>,
) -> Result<DisconnectSuccessTS, DisconnectFailureTS> {
    let request_id = Uuid::new_v4();
    // Convert the string cid to u64
    let cid = request.cid.parse::<u64>().unwrap();

    let payload = Disconnect { cid, request_id };

    let response = send_and_recv(payload, request_id, &state).await;

    match response {
        InternalServiceResponse::PeerDisconnectSuccess(success) => {
            println!("Disconnection successful");
            Ok(DisconnectSuccessTS {
                cid: success.cid.to_string(),
                request_id: success.request_id.map(|id| id.to_string()),
            })
        }
        InternalServiceResponse::PeerDisconnectFailure(err) => {
            println!("Disconnection failure: {:#?}", err);
            Err(DisconnectFailureTS {
                cid: err.cid.to_string(),
                message: err.message,
                request_id: err.request_id.map(|id| id.to_string()),
            })
        }
        other => {
            let error_msg = format!(
                "Internal service returned unexpected type '{}' during disconnection",
                std::any::type_name_of_val(&other)
            );
            println!("{}", error_msg);
            Err(DisconnectFailureTS {
                cid: cid.to_string(),
                message: error_msg,
                request_id: Some(request_id.to_string()),
            })
        }
    }
}
