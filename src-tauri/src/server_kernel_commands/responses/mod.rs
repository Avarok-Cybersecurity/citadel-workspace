use crate::state::WorkspaceState;
use citadel_internal_service_types::MessageNotification;
use citadel_workspace_types::WorkspaceProtocolResponse;
use serde_json::json;
use std::error::Error;
use tauri::Emitter;
use uuid::Uuid;

pub async fn handle(
    response: WorkspaceProtocolResponse,
    state: &WorkspaceState,
    notification: &MessageNotification,
) -> Result<(), Box<dyn Error>> {
    // Extract connection IDs from the notification
    let cid = notification.cid;
    let peer_cid = notification.peer_cid;

    // Generate a unique request_id for tracking
    let request_id = Uuid::new_v4().to_string();

    // Include connection information in response events
    let connection_info = json!({
        "cid": cid,
        "peer_cid": peer_cid,
        "request_id": request_id
    });

    // Use pattern matching to directly handle the response
    match response {
        // Success response
        WorkspaceProtocolResponse::Success => {
            // Emit a generic success event with connection info
            state
                .window
                .get()
                .expect("unset")
                .emit("operation:success", connection_info)
                .map_err(|e| Box::new(e) as Box<dyn Error>)?;

            Ok(())
        }

        // Error response
        WorkspaceProtocolResponse::Error(error_message) => {
            // Include both the error message and connection info
            let error_info = json!({
                "message": error_message,
                "connection": connection_info
            });

            // Emit error event with the error info
            state
                .window
                .get()
                .expect("unset")
                .emit("operation:error", error_info)
                .map_err(|e| Box::new(e) as Box<dyn Error>)?;

            Ok(())
        }

        // Office-related responses
        WorkspaceProtocolResponse::Office(office) => {
            // Combine office data with connection info
            let payload = json!({
                "office": office,
                "connection": connection_info
            });

            // Emit event to frontend with the combined data
            state
                .window
                .get()
                .expect("unset")
                .emit("office:loaded", payload)
                .map_err(|e| Box::new(e) as Box<dyn Error>)?;

            Ok(())
        }

        WorkspaceProtocolResponse::Offices(offices) => {
            // Combine offices list with connection info
            let payload = json!({
                "offices": offices,
                "connection": connection_info
            });

            // Emit event to frontend with the combined data
            state
                .window
                .get()
                .expect("unset")
                .emit("offices:loaded", payload)
                .map_err(|e| Box::new(e) as Box<dyn Error>)?;

            Ok(())
        }

        // Room-related responses
        WorkspaceProtocolResponse::Room(room) => {
            // Combine room data with connection info
            let payload = json!({
                "room": room,
                "connection": connection_info
            });

            // Emit event to frontend with the combined data
            state
                .window
                .get()
                .expect("unset")
                .emit("room:loaded", payload)
                .map_err(|e| Box::new(e) as Box<dyn Error>)?;

            Ok(())
        }

        WorkspaceProtocolResponse::Rooms(rooms) => {
            // Combine rooms list with connection info
            let payload = json!({
                "rooms": rooms,
                "connection": connection_info
            });

            // Emit event to frontend with the combined data
            state
                .window
                .get()
                .expect("unset")
                .emit("rooms:loaded", payload)
                .map_err(|e| Box::new(e) as Box<dyn Error>)?;

            Ok(())
        }

        // Member-related responses
        WorkspaceProtocolResponse::Member(member) => {
            // Combine member data with connection info
            let payload = json!({
                "member": member,
                "connection": connection_info
            });

            // Emit event to frontend with the combined data
            state
                .window
                .get()
                .expect("unset")
                .emit("member:loaded", payload)
                .map_err(|e| Box::new(e) as Box<dyn Error>)?;

            Ok(())
        }

        WorkspaceProtocolResponse::Members(members) => {
            // Combine members list with connection info
            let payload = json!({
                "members": members,
                "connection": connection_info
            });

            // Emit event to frontend with the combined data
            state
                .window
                .get()
                .expect("unset")
                .emit("members:loaded", payload)
                .map_err(|e| Box::new(e) as Box<dyn Error>)?;

            Ok(())
        }
    }
}
