//! SetDefaultAppTabs: the app tabs every node without a list of its own shows.
//!
//! Gated on `EditWorkspaceConfig`, as the workspace's other member-facing settings are, and
//! checked before the input is looked at, so a caller without it is refused identically whatever
//! they send. `UpdateWorkspace` could write the key too, but it demands the master password, the
//! credential that also claims and deletes the workspace: choosing which tabs pages open with
//! should not need it.

use super::workspace_record::mutate_workspace;
use crate::handlers::domain::server_ops::node_metadata_merge::with_default_app_tabs;
use crate::kernel::async_kernel::AsyncWorkspaceServerKernel;
use crate::WorkspaceProtocolResponse;
use citadel_sdk::prelude::{NetworkError, Ratchet};
use citadel_workspace_types::structs::Permission;

/// The permission that sets a workspace's default tabs.
pub(super) const SETS_DEFAULT_APP_TABS: Permission = Permission::EditWorkspaceConfig;

pub(super) async fn set_default_app_tabs<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    actor_user_id: &str,
    requester_cid: Option<u64>,
    app_tabs: &[String],
) -> Result<WorkspaceProtocolResponse, NetworkError> {
    let allowed = kernel
        .domain_operations
        .holds_workspace_permission(actor_user_id, SETS_DEFAULT_APP_TABS)
        .await
        .unwrap_or(false);
    if !allowed {
        return Ok(WorkspaceProtocolResponse::Error(
            "Permission denied: EditWorkspaceConfig is required to set the default tabs"
                .to_string(),
        ));
    }
    mutate_workspace(
        kernel,
        crate::WORKSPACE_ROOT_ID,
        requester_cid,
        "default tabs",
        |workspace| {
            workspace.metadata = with_default_app_tabs(&workspace.metadata, app_tabs)?;
            Ok(())
        },
    )
    .await
}
