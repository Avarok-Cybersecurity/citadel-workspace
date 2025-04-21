use crate::types::{ConnectFailureTS, ConnectRequestTS, ConnectSuccessTS};
use citadel_internal_service_types::{InternalServiceRequest, InternalServiceResponse};
use log::{error, info};
use tauri::State;
use uuid::Uuid;

use crate::state::WorkspaceState;

use super::send_and_recv;

#[tauri::command]
pub async fn connect(
    request: ConnectRequestTS,
    state: State<'_, WorkspaceState>,
) -> Result<ConnectSuccessTS, ConnectFailureTS> {
    println!("Attempting to connect with username {}", request.username);

    // Create a request ID for this specific invocation
    let request_id = Uuid::new_v4();

    let internal_request: InternalServiceRequest = match request.try_into() {
        Ok(req) => req,
        Err(e) => {
            let error_msg = format!("Failed to convert request to internal request: {}", e);
            println!("{}", error_msg);
            return Err(ConnectFailureTS {
                cid: "0".to_string(),
                message: error_msg,
                request_id: Some(request_id.to_string()),
                peer_cid: None,
            });
        }
    };

    let response = send_and_recv(internal_request, request_id, &state).await;

    match response {
        InternalServiceResponse::ConnectSuccess(success) => {
            println!("Connection was successful");

            info!(target: "citadel", "ConnectSuccess: CID={}", success.cid);

            Ok(ConnectSuccessTS {
                cid: success.cid.to_string(),
                request_id: success.request_id.map(|id| id.to_string()),
            })
        }
        InternalServiceResponse::ConnectFailure(err) => {
            println!("Connection failed: {}", err.message);

            info!(target: "citadel", "ConnectFailure: CID={}, Message='{}'", err.cid, err.message);

            Err(ConnectFailureTS {
                cid: err.cid.to_string(),
                peer_cid: None,
                message: err.message,
                request_id: err.request_id.map(|id| id.to_string()),
            })
        }
        other => {
            let error_msg = format!(
                "Internal service returned unexpected type '{}' during connection",
                std::any::type_name_of_val(&other)
            );
            println!("{}", error_msg);
            error!(target: "citadel", "{}", error_msg);
            Err(ConnectFailureTS {
                cid: "0".to_string(),
                message: error_msg,
                request_id: Some(request_id.to_string()),
                peer_cid: None,
            })
        }
    }
}
