use citadel_internal_service_types::{
    InternalServiceRequest::PeerConnect, InternalServiceResponse,
};
use serde::{Deserialize, Serialize};
use tauri::State;
use uuid::Uuid;

use crate::structs::ConnectionRouterState;

use super::send_and_recv;

#[allow(non_snake_case)]
#[derive(Debug, Serialize, Deserialize)]
pub struct PeerConnectRequestTS {
    pub cid: String,
    pub peerCid: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PeerConnectResponseTS {
    success: bool,
    message: Option<String>,
}

#[tauri::command]
pub async fn peer_connect(
    request: PeerConnectRequestTS,
    state: State<'_, ConnectionRouterState>,
) -> Result<PeerConnectResponseTS, String> {
    let request_id = Uuid::new_v4();
    let payload = PeerConnect {
        request_id,
        cid: request.cid.parse::<u64>().unwrap(),
        peer_cid: request.peerCid.parse::<u64>().unwrap(),
        udp_mode: Default::default(),
        session_security_settings: Default::default(),
        peer_session_password: None,
    };

    let response = send_and_recv(payload, request_id, &state).await;

    match response {
        InternalServiceResponse::PeerConnectSuccess(_) => Ok(PeerConnectResponseTS {
            success: true,
            message: None,
        }),
        InternalServiceResponse::PeerConnectFailure(r) => {
            println!("Peer connect failed: {}", r.message);
            Ok(PeerConnectResponseTS {
                success: false,
                message: Some(r.message),
            })
        }
        other => {
            panic!(
                "Internal service returned unexpected type '{}' during registration",
                std::any::type_name_of_val(&other)
            )
        }
    }
}
