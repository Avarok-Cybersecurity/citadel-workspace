
use std::collections::HashMap;

use citadel_internal_service_types::{InternalServiceRequest::ListAllPeers, InternalServiceResponse, PeerInformation};
use serde::{Deserialize, Serialize};
use tauri::State;
use uuid::Uuid;

use crate::structs::ConnectionState;

use super::send_and_recv;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ListAllPeersRequestTS{
    cid: String
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ListAllPeersResponseTS{
    pub peers: Option<HashMap<String, PeerInformation>>,
    pub success: bool,
    pub message: String
}


#[tauri::command]
pub async fn list_all_peers(
    request: ListAllPeersRequestTS,
    state: State<'_, ConnectionState>,
) -> Result<ListAllPeersResponseTS, String> {

    println!("Listing all peers...");
    let request_id = Uuid::new_v4();

    let cid = request.cid.parse().unwrap();

    let payload = ListAllPeers { cid, request_id };

    let response = send_and_recv(payload, request_id, &state).await;

    match response {
        InternalServiceResponse::ListAllPeersResponse(resp) => {
            println!("Success");
            Ok(ListAllPeersResponseTS {
                peers: Some(resp.peer_information.into_iter().map(|(cid, info)| (cid.to_string(), info) ).collect()),
                success: true,
                message: "success".to_string()
            } )
        },
        InternalServiceResponse::ListAllPeersFailure(err) => {
            println!("Error listing all peers: {:#?}", err);
            Ok(ListAllPeersResponseTS {
                peers: None,
                success: false,
                message: err.message,
            } )
        }
        other => {
            panic!("Internal service returned unexpected type '{}' during connection", std::any::type_name_of_val(&other))
        }
    }

}
