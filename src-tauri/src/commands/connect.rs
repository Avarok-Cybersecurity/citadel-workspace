use crate::types::{ConnectFailureTS, ConnectRequestTS, ConnectSuccessTS};
use citadel_internal_service_types::{
    ConnectMode, InternalServiceRequest, InternalServiceResponse, UdpMode,
};
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

    // Convert u8 values to the correct enum types using pattern matching
    let connect_mode = match request.connect_mode {
        // Use the actual variants available in ConnectMode
        0 => ConnectMode::default(),
        _ => ConnectMode::default(),
    };

    let udp_mode = match request.udp_mode {
        // Use the actual variants available in UdpMode
        0 => UdpMode::default(),
        _ => UdpMode::default(),
    };

    // Convert server_password to Option<Vec<u8>> before sending
    let server_password = request.server_password.map(|vec_u8| vec_u8.into());

    let payload = InternalServiceRequest::Connect {
        request_id,
        username: request.username.clone(),
        password: request.password.into(),
        connect_mode,
        udp_mode,
        keep_alive_timeout: request
            .keep_alive_timeout
            .map(std::time::Duration::from_millis),
        session_security_settings: request.session_security_settings.into(),
        server_password,
    };

    let response = send_and_recv(payload, request_id, &state).await;

    match response {
        InternalServiceResponse::ConnectSuccess(success) => {
            println!("Connection was successful");
            Ok(ConnectSuccessTS {
                cid: success.cid.to_string(),
                request_id: success.request_id.map(|id| id.to_string()),
            })
        }
        InternalServiceResponse::ConnectFailure(err) => {
            println!("Connection failed: {}", err.message);
            Err(ConnectFailureTS {
                cid: err.cid.to_string(),
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
            Err(ConnectFailureTS {
                cid: "0".to_string(),
                message: error_msg,
                request_id: Some(request_id.to_string()),
            })
        }
    }
}
