// Workspace protocol request handlers
use crate::state::WorkspaceState;
use citadel_internal_service_types::MessageNotification;
use citadel_logging::warn;
use citadel_workspace_types::WorkspaceProtocolRequest;
use serde_json::json;
use std::error::Error;
use tauri::Emitter;

pub async fn handle(
    request: WorkspaceProtocolRequest,
    state: &WorkspaceState,
    notification: &MessageNotification,
) -> Result<(), Box<dyn Error>> {
    // Extract connection IDs from the notification
    let cid = notification.cid;
    let peer_cid = notification.peer_cid;

    // Generate a unique request_id for tracking
    let request_id = notification.request_id;

    // Create a base connection info payload that will be included in all events
    let connection_info = json!({
        "cid": cid,
        "peer_cid": peer_cid,
        "request_id": request_id
    });

    // Check if this is a direct peer message - only Message requests should be received directly from peers
    if !matches!(request, WorkspaceProtocolRequest::Message { .. }) {
        // This is a non-Message request from a peer, which is unusual and likely an error
        let request_type = match request {
            WorkspaceProtocolRequest::LoadWorkspace => "LoadWorkspace",
            WorkspaceProtocolRequest::CreateWorkspace { .. } => "CreateWorkspace",
            WorkspaceProtocolRequest::GetWorkspace => "GetWorkspace",
            WorkspaceProtocolRequest::UpdateWorkspace { .. } => "UpdateWorkspace",
            WorkspaceProtocolRequest::DeleteWorkspace { .. } => "DeleteWorkspace",
            WorkspaceProtocolRequest::CreateOffice { .. } => "CreateOffice",
            WorkspaceProtocolRequest::GetOffice { .. } => "GetOffice",
            WorkspaceProtocolRequest::UpdateOffice { .. } => "UpdateOffice",
            WorkspaceProtocolRequest::DeleteOffice { .. } => "DeleteOffice",
            WorkspaceProtocolRequest::ListOffices => "ListOffices",
            WorkspaceProtocolRequest::CreateRoom { .. } => "CreateRoom",
            WorkspaceProtocolRequest::GetRoom { .. } => "GetRoom",
            WorkspaceProtocolRequest::UpdateRoom { .. } => "UpdateRoom",
            WorkspaceProtocolRequest::DeleteRoom { .. } => "DeleteRoom",
            WorkspaceProtocolRequest::ListRooms { .. } => "ListRooms",
            WorkspaceProtocolRequest::AddMember { .. } => "AddMember",
            WorkspaceProtocolRequest::GetMember { .. } => "GetMember",
            WorkspaceProtocolRequest::UpdateMemberRole { .. } => "UpdateMemberRole",
            WorkspaceProtocolRequest::UpdateMemberPermissions { .. } => "UpdateMemberPermissions",
            WorkspaceProtocolRequest::RemoveMember { .. } => "RemoveMember",
            WorkspaceProtocolRequest::ListMembers { .. } => "ListMembers",
            WorkspaceProtocolRequest::Message { .. } => unreachable!(), // We already checked this isn't a Message
        };

        warn!("Received non-Message request ({}) directly from peer CID: {:?}. This request type should only be sent to the server.", request_type, peer_cid);

        // Emit a warning event to the frontend
        let warning_payload = json!({
            "message": format!("Unexpected request type '{}' received directly from peer. This could indicate a protocol error.", request_type),
            "requestType": request_type,
            "connection": connection_info
        });

        state
            .window
            .get()
            .expect("unset")
            .emit("protocol:warning", warning_payload)
            .map_err(|e| Box::new(e) as Box<dyn Error>)?;
        return Ok(());
    }

    if let WorkspaceProtocolRequest::Message { contents } = request {
        // Create payload with peer info and content length
        let payload = json!({
            "peerCid": peer_cid,
            "contentLength": contents.len(),
            "connection": connection_info,
            "contents": String::from_utf8(contents)?,
        });

        // Emit event to front-end to show we received a message
        state
            .window
            .get()
            .expect("unset")
            .emit("message:received", payload)
            .map_err(|e| Box::new(e) as Box<dyn Error>)?;
    }

    Ok(())
}
