/*
    // Create a room within the office
    let room_result = execute_command(
        &kernel,
        WorkspaceProtocolRequest::CreateRoom {
            office_id: office_id.clone(),
            name: "Test Room".to_string(),
            description: "Test Room Description".to_string(),
            mdx_content: None,
            metadata: None,
        },
    ).await;
*/

use citadel_sdk::prelude::{NetworkError, Ratchet};
use citadel_workspace_server_kernel::kernel::{
    async_kernel::{AsyncWorkspaceServerKernel, ADMIN_ROOT_USER_ID},
    command_processor::async_process_command::process_command_with_user,
};
use citadel_workspace_types::{
    structs::{Office, Room},
    WorkspaceProtocolRequest, WorkspaceProtocolResponse,
};

pub async fn execute_command<R: Ratchet>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    request: WorkspaceProtocolRequest,
) -> Result<WorkspaceProtocolResponse, NetworkError> {
    process_command_with_user(kernel, &request, ADMIN_ROOT_USER_ID).await
}

pub fn extract_success(message: WorkspaceProtocolResponse) -> Option<String> {
    let WorkspaceProtocolResponse::Success(success) = message else {
        return None;
    };
    Some(success)
}

pub fn extract_room(message: WorkspaceProtocolResponse) -> Option<Room> {
    let WorkspaceProtocolResponse::Room(room) = message else {
        return None;
    };
    Some(room)
}

pub fn extract_office(message: WorkspaceProtocolResponse) -> Option<Office> {
    let WorkspaceProtocolResponse::Office(office) = message else {
        return None;
    };
    Some(office)
}
