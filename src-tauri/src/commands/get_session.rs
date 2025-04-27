use crate::commands::send_and_recv;
use crate::state::WorkspaceState;
use crate::types::{
    GetSessionFailureTS, GetSessionRequestTS, GetSessionSuccessTS, PeerSessionInformationTS,
    SessionInformationTS,
};
use citadel_internal_service_types::{InternalServiceRequest, InternalServiceResponse};
use log::error;
use tauri::State;
use uuid::Uuid;

#[tauri::command]
pub async fn get_sessions(
    _request: GetSessionRequestTS,
    state: State<'_, WorkspaceState>,
) -> Result<GetSessionSuccessTS, GetSessionFailureTS> {
    let request_id = Uuid::new_v4();

    let payload = InternalServiceRequest::GetSessions { request_id };

    let response = send_and_recv(payload, request_id, &state).await;

    let result = match response {
        // Try to extract session information from any success response type
        InternalServiceResponse::GetSessionsResponse(success) => {
            // Map internal SessionInformation to SessionInformationTS
            let sessions_ts: Vec<SessionInformationTS> = success
                .sessions
                .into_iter()
                .map(|session_info| {
                    // Convert the internal peer connections map to the TS version
                    let peer_connections_ts: std::collections::HashMap<
                        String,
                        PeerSessionInformationTS,
                    > = session_info
                        .peer_connections
                        .into_iter() // Iterate over the internal HashMap
                        .map(|(key, peer_info)| {
                            // Manually create PeerSessionInformationTS
                            let peer_info_ts = PeerSessionInformationTS {
                                cid: peer_info.cid.to_string(), // Assuming peer_info.cid is Uuid
                                peer_cid: peer_info.peer_cid.to_string(), // Assuming peer_info.peer_cid is u64
                                peer_username: peer_info.peer_username, // Assuming peer_info.peer_username is String
                            };
                            (key.to_string(), peer_info_ts) // Return the String key and the converted TS struct
                        })
                        .collect(); // Collect into the new HashMap

                    SessionInformationTS {
                        cid: session_info.cid.to_string(),
                        peer_connections: peer_connections_ts,
                    }
                })
                .collect();

            Ok(GetSessionSuccessTS {
                request_id: None,
                sessions: sessions_ts,
            })
        }
        // Treat any other response as an error
        other => {
            // Log the unexpected response for debugging
            error!("Unexpected get_sessions response:\n{:#?}", other);
            Err(GetSessionFailureTS {
                request_id: other.request_id().map(|id| id.to_string()), // Pass Option<String> directly
                message: "Internal Error: unknown response type".to_owned(),
            })
        }
    };

    result
}
