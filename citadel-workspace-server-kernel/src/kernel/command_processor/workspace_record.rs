//! Changing a stored workspace record: one read-modify-write for every request that does it.
//!
//! Every such change has to:
//! - hold the workspace lock across the read and the write, or a concurrent member or settings
//!   update reads the same record and whichever writes second discards the other's field;
//! - write the denormalized `Domain::Workspace` copy as well, or a reader that goes through the
//!   domain sees the old record and eventually writes it back;
//! - announce the result to this workspace's members only, never to every connected session,
//!   because the record carries the full member list.
//!
//! The theme request did all three by hand. The profile request needs the same, so the sequence
//! lives here once.

use crate::kernel::async_kernel::AsyncWorkspaceServerKernel;
use crate::WorkspaceProtocolResponse;
use citadel_sdk::prelude::{NetworkError, Ratchet};
use citadel_workspace_types::structs::{Domain, Workspace};

/// Apply `edit` to the stored workspace `workspace_id`, save both copies, and announce it.
///
/// `edit` refusing, or the workspace not existing, is answered as an `Error` response. A storage
/// failure is returned as `Err`, as the other handlers do.
pub(super) async fn mutate_workspace<R, F>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    workspace_id: &str,
    requester_cid: Option<u64>,
    what: &str,
    edit: F,
) -> Result<WorkspaceProtocolResponse, NetworkError>
where
    R: Ratchet + Send + Sync + 'static,
    F: FnOnce(&mut Workspace) -> Result<(), String>,
{
    let backend = &kernel.domain_operations.backend_tx_manager;
    let _workspace_guard = backend.lock_workspaces().await;

    let mut workspace = match backend.get_workspace(workspace_id).await {
        Ok(Some(workspace)) => workspace,
        Ok(None) => {
            return Ok(WorkspaceProtocolResponse::Error(
                "Workspace not found".to_string(),
            ))
        }
        Err(e) => {
            return Ok(WorkspaceProtocolResponse::Error(format!(
                "Failed to update workspace {what}: {e}"
            )))
        }
    };
    if let Err(e) = edit(&mut workspace) {
        return Ok(WorkspaceProtocolResponse::Error(e));
    }

    backend
        .insert_workspace(workspace_id.to_string(), workspace.clone())
        .await?;
    backend
        .insert_domain(
            workspace_id.to_string(),
            Domain::Workspace {
                workspace: workspace.clone(),
            },
        )
        .await?;

    kernel.broadcast_to_workspace(
        WorkspaceProtocolResponse::Workspace(workspace.clone()),
        requester_cid,
        workspace.id.clone(),
    );
    Ok(WorkspaceProtocolResponse::Workspace(workspace))
}
