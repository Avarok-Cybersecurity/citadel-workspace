use crate::state::WorkspaceState;
use citadel_internal_service_types::MessageNotification;
use citadel_workspace_types::WorkspaceProtocolPayload;
use std::error::Error;

pub mod requests;
pub mod responses;
pub async fn handle_workspace_protocol_command(
    notification: MessageNotification,
    state: &WorkspaceState,
) -> Result<(), Box<dyn Error>> {
    let command: WorkspaceProtocolPayload = serde_json::from_slice(&notification.message)?;
    match command {
        WorkspaceProtocolPayload::Request(request) => requests::handle(request, state).await,
        WorkspaceProtocolPayload::Response(response) => responses::handle(response, state).await,
    }
}
