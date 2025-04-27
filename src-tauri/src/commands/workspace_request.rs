use crate::state::WorkspaceState;
use crate::types::{MessageSendFailureTS, MessageSendSuccessTS};
use citadel_internal_service_types::InternalServiceRequest;
use citadel_types::prelude::SecurityLevel;
use citadel_workspace_types::WorkspaceProtocolPayload;
use log::error;
use std::str::FromStr;
use tauri::State;
use uuid::Uuid;

/// Sends a workspace request
#[tauri::command]
pub async fn send_workspace_request(
    cid_str: String,                   // Renamed for clarity
    security_level_str: String,        // Renamed for clarity
    payload: WorkspaceProtocolPayload, // Directly accept the structured payload
    state: State<'_, WorkspaceState>,
) -> Result<MessageSendSuccessTS, MessageSendFailureTS> {
    // Log the received payload for debugging case sensitivity issues
    // println!("[Rust Command: send_workspace_request] Received raw payload: {:?}", payload);

    let request_id = Uuid::new_v4();

    // Convert string values to their native types
    let cid = match cid_str.parse::<u64>() {
        Ok(c) => c,
        Err(e) => {
            let err_msg = format!("Invalid cid format '{}': {}", cid_str, e);
            error!(target: "citadel", "{}", err_msg);
            return Err(MessageSendFailureTS {
                cid: cid_str,   // Return original string on error
                peer_cid: None, // No peer_cid in this refactored version
                message: err_msg,
                request_id: Some(request_id.to_string()),
            });
        }
    };

    // Peer CID is always None when sending to the server for workspace requests
    let peer_cid: Option<u64> = None;

    // Determine security level from the request
    let security_level = SecurityLevel::from_str(&security_level_str).map_err(|e| {
        let err_msg = format!("Invalid security level '{}': {:?}", &security_level_str, e);
        error!(target: "citadel", "{}", err_msg);
        MessageSendFailureTS {
            cid: cid_str.clone(), // Use original string cid on error
            peer_cid: None,
            message: err_msg,
            request_id: Some(request_id.to_string()),
        }
    })?;

    // Serialize the WorkspaceProtocolPayload into bytes
    let message_bytes = match serde_json::to_vec(&payload) {
        Ok(bytes) => bytes,
        Err(e) => {
            let err_msg = format!("Failed to serialize workspace payload: {}", e);
            error!(target: "citadel", "{}", err_msg);
            return Err(MessageSendFailureTS {
                cid: cid_str, // Use original string cid on error
                peer_cid: None,
                message: err_msg,
                request_id: Some(request_id.to_string()),
            });
        }
    };

    let internal_request = InternalServiceRequest::Message {
        message: message_bytes,
        cid,
        peer_cid,
        security_level,
        request_id,
    };

    // We do not have request id's here since our UI will handle them
    let res = state.bypasser.send(internal_request).await;

    match res {
        Ok(_) => {
            println!("Message sent successfully");
            Ok(MessageSendSuccessTS {
                cid: cid.to_string(),
                peer_cid: peer_cid.map(|pc| pc.to_string()), // Map Option<u64> to Option<String>
                request_id: None,
            })
        }
        Err(err) => {
            println!("Message send failure: {:#?}", err);
            Err(MessageSendFailureTS {
                cid: cid.to_string(),
                peer_cid: peer_cid.map(|pc| pc.to_string()), // Map Option<u64> to Option<String>
                message: err.to_string(),
                request_id: None,
            })
        }
    }
}
