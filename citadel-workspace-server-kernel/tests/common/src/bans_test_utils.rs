//! `Ban` and `Unban` sent through the protocol, as a client sends them.

use crate::member_test_utils::GateKernel;
use citadel_workspace_server_kernel::kernel::command_processor::async_process_command::process_command_with_user;
use citadel_workspace_types::{WorkspaceProtocolRequest as Req, WorkspaceProtocolResponse as Res};

/// What the kernel answers `actor` for `request`: the response, or the refusal's text.
pub async fn answer(kernel: &GateKernel, actor: &str, request: Req) -> Result<Res, String> {
    match process_command_with_user(kernel, &request, actor)
        .await
        .expect("answered, never a transport error")
    {
        Res::Error(refusal) => Err(refusal),
        response => Ok(response),
    }
}

pub async fn ban(kernel: &GateKernel, actor: &str, target: &str) -> Result<Res, String> {
    let user_id = target.to_string();
    answer(kernel, actor, Req::Ban { user_id }).await
}

pub async fn unban(kernel: &GateKernel, actor: &str, target: &str) -> Result<Res, String> {
    let user_id = target.to_string();
    answer(kernel, actor, Req::Unban { user_id }).await
}
