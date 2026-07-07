use citadel_sdk::prelude::{NetworkError, Ratchet};
use citadel_workspace_server_kernel::kernel::{
    async_kernel::AsyncWorkspaceServerKernel,
    command_processor::async_process_command::process_command_with_user,
};
use citadel_workspace_types::{
    structs::DomainNode, WorkspaceProtocolRequest, WorkspaceProtocolResponse,
};

// Re-export TEST_ADMIN_USER_ID from workspace_test_utils
pub use super::workspace_test_utils::TEST_ADMIN_USER_ID;

pub async fn execute_command<R: Ratchet>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    request: WorkspaceProtocolRequest,
) -> Result<WorkspaceProtocolResponse, NetworkError> {
    process_command_with_user(kernel, &request, TEST_ADMIN_USER_ID).await
}

pub fn extract_success(message: WorkspaceProtocolResponse) -> Option<String> {
    let WorkspaceProtocolResponse::Success(success) = message else {
        return None;
    };
    Some(success)
}

/// Extract a DomainNode from a Node response (used for both offices and rooms)
pub fn extract_node(message: WorkspaceProtocolResponse) -> Option<DomainNode> {
    let WorkspaceProtocolResponse::Node(node) = message else {
        return None;
    };
    Some(node)
}

/// Extract a list of DomainNodes from a Nodes response
pub fn extract_nodes(message: WorkspaceProtocolResponse) -> Option<Vec<DomainNode>> {
    let WorkspaceProtocolResponse::Nodes(nodes) = message else {
        return None;
    };
    Some(nodes)
}
