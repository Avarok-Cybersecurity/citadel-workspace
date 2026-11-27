//! `UpdateNode` naming the workspace root: the home's own app tabs.
//!
//! The home is the root, which is never a stored node, so a node update of it answered "Node not
//! found" and "+" on the home could never add a tab. Its tabs are kept in the workspace record (the
//! root's record) under the key a node keeps them under (`with_home_app_tabs`), gated as a node's
//! are (`update_requires` for a settings change, at the root), and answered and announced as the
//! workspace record. Nothing else about the home is a node field: any other change is refused.

use super::workspace_record::mutate_workspace;
use crate::handlers::domain::async_ops::AsyncPermissionOperations;
use crate::handlers::domain::node_ops::update_requires;
use crate::handlers::domain::server_ops::node_metadata_merge::with_home_app_tabs;
use crate::kernel::async_kernel::AsyncWorkspaceServerKernel;
use crate::{WorkspaceProtocolResponse, WORKSPACE_ROOT_ID};
use citadel_sdk::prelude::{NetworkError, Ratchet};
use citadel_workspace_types::node_tabs::APP_TABS_KEY;
use serde_json::Value;

const ONLY_TABS: &str =
    "The workspace home keeps only its app tabs; nothing else of it is changed as a page";

/// `changes_other`: the update names a field other than `metadata`.
pub(super) async fn update_home_tabs<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    actor_user_id: &str,
    requester_cid: Option<u64>,
    changes_other: bool,
    metadata: Option<&[u8]>,
) -> Result<WorkspaceProtocolResponse, NetworkError> {
    for (permission, label) in update_requires(false, false, true) {
        if !kernel
            .domain_operations
            .check_entity_permission(actor_user_id, WORKSPACE_ROOT_ID, permission)
            .await?
        {
            return Ok(WorkspaceProtocolResponse::Error(format!(
                "Permission denied: {label} required"
            )));
        }
    }
    let tabs = match (changes_other, metadata.map(serde_json::from_slice::<Value>)) {
        (false, Some(Ok(Value::Object(patch)))) if patch.len() == 1 => {
            patch.get(APP_TABS_KEY).cloned()
        }
        _ => None,
    };
    let Some(tabs) = tabs else {
        return Ok(WorkspaceProtocolResponse::Error(ONLY_TABS.to_string()));
    };
    mutate_workspace(
        kernel,
        WORKSPACE_ROOT_ID,
        requester_cid,
        "home tabs",
        |workspace| {
            workspace.metadata = with_home_app_tabs(&workspace.metadata, &tabs)?;
            Ok(())
        },
    )
    .await
}
