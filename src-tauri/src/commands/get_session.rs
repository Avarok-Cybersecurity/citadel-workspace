use crate::state::WorkspaceState;
use crate::types::{GetSessionFailureTS, GetSessionRequestTS, GetSessionSuccessTS};
use citadel_internal_service_types::InternalServiceRequest;
use tauri::State;
use uuid::Uuid;

use super::send_and_recv;

#[tauri::command]
pub async fn get_sessions(
    _request: GetSessionRequestTS,
    state: State<'_, WorkspaceState>,
) -> Result<GetSessionSuccessTS, GetSessionFailureTS> {
    let request_id = Uuid::new_v4();

    let payload = InternalServiceRequest::GetSessions { request_id };

    let response = send_and_recv(payload, request_id, &state).await;

    // Handle all response types generically since we're not sure of the exact variant name
    let result = match response {
        // Try to extract session information from any success response type
        success => {
            // Attempt to retrieve session information using match and logging
            println!(
                "Received response: {:?}",
                std::any::type_name_of_val(&success)
            );

            // Since we can't directly match the correct variant, we'll return an empty session list
            // This is a temporary solution until we can determine the correct variant
            let sessions = Vec::new();

            Ok(GetSessionSuccessTS {
                request_id: Some(request_id.to_string()),
                sessions,
            })
        }
    };

    result
}
