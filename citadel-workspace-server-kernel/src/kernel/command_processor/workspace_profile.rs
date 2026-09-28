//! UpdateWorkspaceProfile: rename a workspace, describe it, or change its icon.
//!
//! Gated on Permission::UpdateWorkspace rather than the master password, which also claims and
//! deletes the workspace; see the request's doc comment. The permission is checked before the
//! input is looked at, so a caller without it is refused identically whatever they send.

use super::workspace_logo::validate_logo;
use super::workspace_record::mutate_workspace;
use crate::handlers::domain::async_ops::AsyncPermissionOperations;
use crate::handlers::domain::server_ops::metadata_merge::merge_metadata_document;
use crate::kernel::async_kernel::AsyncWorkspaceServerKernel;
use crate::{validate_workspace_name, WorkspaceProtocolResponse, MAX_WORKSPACE_DESCRIPTION_CHARS};
use citadel_sdk::prelude::{NetworkError, Ratchet};
use citadel_workspace_types::structs::{Permission, WorkspaceLogoChange};

pub(super) struct ProfileChange<'a> {
    pub workspace_id: Option<&'a str>,
    pub name: Option<&'a str>,
    pub description: Option<&'a str>,
    pub logo: Option<&'a WorkspaceLogoChange>,
}

pub(super) async fn update_workspace_profile<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    actor_user_id: &str,
    requester_cid: Option<u64>,
    change: ProfileChange<'_>,
) -> Result<WorkspaceProtocolResponse, NetworkError> {
    let target_id = change.workspace_id.unwrap_or(crate::WORKSPACE_ROOT_ID);

    let allowed = kernel
        .domain_operations
        .check_entity_permission(actor_user_id, target_id, Permission::UpdateWorkspace)
        .await
        .unwrap_or(false);
    if !allowed {
        return Ok(WorkspaceProtocolResponse::Error(
            "Permission denied: UpdateWorkspace required".to_string(),
        ));
    }

    let name = match change.name.map(validate_workspace_name).transpose() {
        Ok(name) => name,
        Err(e) => {
            return Ok(WorkspaceProtocolResponse::Error(format!(
                "The workspace name {e}"
            )))
        }
    };
    if let Some(description) = change.description {
        if description.chars().count() > MAX_WORKSPACE_DESCRIPTION_CHARS {
            return Ok(WorkspaceProtocolResponse::Error(format!(
                "The description must be at most {MAX_WORKSPACE_DESCRIPTION_CHARS} characters"
            )));
        }
    }
    let logo_patch = match change.logo {
        None => None,
        Some(WorkspaceLogoChange::Clear) => Some(serde_json::json!({ "logo": null })),
        Some(WorkspaceLogoChange::Set { data_url }) => match validate_logo(data_url) {
            Ok(()) => Some(serde_json::json!({ "logo": data_url })),
            Err(e) => return Ok(WorkspaceProtocolResponse::Error(e)),
        },
    };

    mutate_workspace(kernel, target_id, requester_cid, "profile", |workspace| {
        if let Some(name) = name {
            workspace.name = name;
        }
        if let Some(description) = change.description {
            workspace.description = description.trim().to_string();
        }
        if let Some(patch) = logo_patch {
            // Merged under its own key: metadata is shared with `initialized` and `theme`.
            let bytes = serde_json::to_vec(&patch)
                .map_err(|e| format!("Failed to encode the icon: {e}"))?;
            workspace.metadata = merge_metadata_document(&workspace.metadata, &bytes)?;
        }
        Ok(())
    })
    .await
}
