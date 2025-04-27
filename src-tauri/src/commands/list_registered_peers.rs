use crate::state::WorkspaceState;
use crate::types::{
    string_to_u64, ListRegisteredPeersFailureTS, ListRegisteredPeersRequestTS,
    ListRegisteredPeersSuccessTS, PeerInfoTS,
};
use citadel_internal_service_types::{InternalServiceRequest, InternalServiceResponse};
use tauri::State;
use uuid::Uuid;

use super::send_and_recv;

#[tauri::command]
pub async fn list_registered_peers(
    request: ListRegisteredPeersRequestTS,
    state: State<'_, WorkspaceState>,
) -> Result<ListRegisteredPeersSuccessTS, ListRegisteredPeersFailureTS> {
    let request_id = Uuid::new_v4();

    // Convert string CID to u64, mapping potential error
    let cid = string_to_u64(&request.cid).map_err(|e| ListRegisteredPeersFailureTS {
        message: e,
        request_id: Some(request_id.to_string()),
    });

    let payload = InternalServiceRequest::ListRegisteredPeers {
        cid: cid?,
        request_id,
    };

    let response = send_and_recv(payload, request_id, &state).await;

    match response {
        // Using the correct enum variant name
        InternalServiceResponse::ListRegisteredPeersResponse(success) => {
            println!("List registered peers successful");

            // Convert peer information to TypeScript-friendly format
            let peers = success
                .peers
                .iter()
                .map(|(peer_cid, peer_info)| PeerInfoTS {
                    cid: peer_cid.to_string(),
                    // Handle Option<String> for username
                    username: peer_info
                        .username
                        .clone()
                        .unwrap_or_else(|| "Unknown".to_string()),
                })
                .collect();

            Ok(ListRegisteredPeersSuccessTS {
                request_id: success.request_id.map(|id| id.to_string()),
                peers,
            })
        }
        // Handle any other response as an error
        other => {
            let error_msg = format!(
                "Internal service returned unexpected type '{}' during list registered peers",
                std::any::type_name_of_val(&other)
            );
            println!("{}", error_msg);
            Err(ListRegisteredPeersFailureTS {
                request_id: Some(request_id.to_string()),
                message: error_msg,
            })
        }
    }
}
