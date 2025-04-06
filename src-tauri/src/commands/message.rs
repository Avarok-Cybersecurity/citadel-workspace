use crate::state::WorkspaceState;
use crate::types::{string_to_u64, MessageRequestTS, MessageSendFailureTS, MessageSendSuccessTS};
use citadel_internal_service_types::{
    InternalServiceRequest::Message, InternalServiceResponse, SecurityLevel,
};
use tauri::State;
use uuid::Uuid;

use super::send_and_recv;

#[tauri::command]
pub async fn message(
    request: MessageRequestTS,
    state: State<'_, WorkspaceState>,
) -> Result<MessageSendSuccessTS, MessageSendFailureTS> {
    let request_id = Uuid::new_v4();

    // Convert string values to their native types
    let cid = string_to_u64(&request.cid);
    let peer_cid = request.peer_cid.as_ref().map(|s| string_to_u64(s));

    // Determine security level from the request
    let security_level = SecurityLevel::from(request.security_level);

    let payload = Message {
        message: request.message,
        cid,
        peer_cid,
        security_level,
        request_id,
    };

    let response = send_and_recv(payload, request_id, &state).await;

    match response {
        InternalServiceResponse::MessageSendSuccess(success) => {
            println!("Message sent successfully");
            Ok(MessageSendSuccessTS {
                cid: success.cid.to_string(),
                peer_cid: success.peer_cid.map(|id| id.to_string()),
                request_id: success.request_id.map(|id| id.to_string()),
            })
        }
        InternalServiceResponse::MessageSendFailure(err) => {
            println!("Message send failure: {:#?}", err);
            Err(MessageSendFailureTS {
                cid: err.cid.to_string(),
                message: err.message,
                request_id: err.request_id.map(|id| id.to_string()),
            })
        }
        other => {
            let error_msg = format!(
                "Internal service returned unexpected type '{}' during message sending",
                std::any::type_name_of_val(&other)
            );
            println!("{}", error_msg);
            Err(MessageSendFailureTS {
                cid: cid.to_string(),
                message: error_msg,
                request_id: Some(request_id.to_string()),
            })
        }
    }
}
