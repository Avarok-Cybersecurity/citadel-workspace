use std::collections::HashMap;

use crate::types::{
    string_to_u64, ListAllPeersFailureTS, ListAllPeersRequestTS, ListAllPeersResponseTS,
    PeerInformationTS,
};
use citadel_internal_service_types::{
    InternalServiceRequest::ListAllPeers, InternalServiceResponse,
};
use tauri::State;
use uuid::Uuid;

use crate::state::WorkspaceState;

use super::send_and_recv;

// Note: We're now using the centralized type definitions from types.rs
// These struct definitions can be removed when all files have been updated
// #[derive(Serialize, Deserialize, Clone, Debug)]
// pub struct ListAllPeersRequestTS {
//     cid: String,
// }
//
// #[derive(Serialize, Deserialize, Clone, Debug)]
// pub struct ListAllPeersResponseTS {
//     pub peers: Option<HashMap<String, PeerInformation>>,
//     pub success: bool,
//     pub message: String,
// }

#[tauri::command]
pub async fn list_all_peers(
    request: ListAllPeersRequestTS,
    state: State<'_, WorkspaceState>,
) -> Result<ListAllPeersResponseTS, ListAllPeersFailureTS> {
    println!("Listing all peers...");
    let request_id = Uuid::new_v4();

    let cid = string_to_u64(&request.cid);

    let payload = ListAllPeers { cid, request_id };

    let response = send_and_recv(payload, request_id, &state).await;

    match response {
        InternalServiceResponse::ListAllPeersResponse(resp) => {
            println!("Successfully retrieved list of peers");

            // Convert the peer_information map to our TypeScript-friendly structure
            let peers: HashMap<String, PeerInformationTS> = resp
                .peer_information
                .into_iter()
                .map(|(peer_cid, info)| {
                    let ts_info = PeerInformationTS {
                        cid: peer_cid.to_string(),
                        online_status: info.online_status,
                        name: info.name,
                        username: info.username,
                    };
                    (peer_cid.to_string(), ts_info)
                })
                .collect();

            Ok(ListAllPeersResponseTS {
                cid: resp.cid.to_string(),
                peers,
                request_id: resp.request_id.map(|id| id.to_string()),
            })
        }
        InternalServiceResponse::ListAllPeersFailure(err) => {
            println!("Error listing all peers: {:#?}", err);
            Err(ListAllPeersFailureTS {
                cid: err.cid.to_string(),
                message: err.message,
                request_id: err.request_id.map(|id| id.to_string()),
            })
        }
        other => {
            let error_msg = format!(
                "Internal service returned unexpected type '{}' during peer listing",
                std::any::type_name_of_val(&other)
            );
            println!("{}", error_msg);
            Err(ListAllPeersFailureTS {
                cid: cid.to_string(),
                message: error_msg,
                request_id: Some(request_id.to_string()),
            })
        }
    }
}
