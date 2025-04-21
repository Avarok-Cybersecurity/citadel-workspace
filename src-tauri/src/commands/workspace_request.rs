use crate::state::WorkspaceState;
use crate::types::{MessageRequestTS, MessageSendFailureTS, MessageSendSuccessTS};
use citadel_internal_service_types::{
    InternalServiceRequest, SecurityLevel,
};
use log::error;
use std::str::FromStr;
use tauri::State;
use uuid::Uuid;

/// Sends a workspace request
#[tauri::command]
pub async fn send_workspace_request(
    request: MessageRequestTS,
    state: State<'_, WorkspaceState>,
) -> Result<MessageSendSuccessTS, MessageSendFailureTS> {
    let request_id = Uuid::new_v4();

    // Convert string values to their native types
    let cid = request.cid.parse::<u64>().unwrap();
    let peer_cid = request.peer_cid.as_ref().map(|s| s.parse::<u64>().unwrap());

    // Determine security level from the request
    let security_level = SecurityLevel::from_str(&request.security_level).map_err(|e| {
        let err_msg = format!(
            "Invalid security level '{}': {:?}",
            request.security_level, e
        );
        error!(target: "citadel", "{}", err_msg);
        MessageSendFailureTS {
            cid: request.cid.clone(),           // Use original string cid on error
            peer_cid: request.peer_cid.clone(), // Use original string peer_cid on error
            message: err_msg,
            request_id: Some(request_id.to_string()),
        }
    })?;

    let payload = InternalServiceRequest::Message {
        message: request.message,
        cid,
        peer_cid,
        security_level,
        request_id,
    };

    // We do not have request id's here since our UI will handle them
    let res = state.bypasser.send(payload).await;

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
