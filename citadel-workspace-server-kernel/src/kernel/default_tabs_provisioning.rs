//! Giving the root workspace its default app tabs when it has none.
//!
//! Run at every boot, after the root workspace is created or found. It writes only when the
//! workspace lacks `default_app_tabs`: a new workspace, or one provisioned before node tabs
//! existed. After that the key is there, and an administrator's list, `[]` included, is theirs;
//! nothing removes the key, so this is a one-shot migration however often it runs.

use crate::handlers::domain::server_ops::node_metadata_merge::provisioned_default_app_tabs;
use crate::kernel::async_kernel::AsyncWorkspaceServerKernel;
use citadel_sdk::prelude::{NetworkError, Ratchet};
use citadel_workspace_types::structs::Domain;

impl<R: Ratchet + Send + Sync + 'static> AsyncWorkspaceServerKernel<R> {
    pub(crate) async fn provision_default_app_tabs(&self) -> Result<(), NetworkError> {
        let backend = &self.domain_operations.backend_tx_manager;
        let _workspace_guard = backend.lock_workspaces().await;
        let Some(mut workspace) = backend.get_workspace(crate::WORKSPACE_ROOT_ID).await? else {
            return Ok(());
        };
        let Some(metadata) =
            provisioned_default_app_tabs(&workspace.metadata).map_err(NetworkError::msg)?
        else {
            return Ok(());
        };
        log::info!(target: "citadel", "Giving the root workspace its default app tabs");
        workspace.metadata = metadata;
        backend
            .insert_workspace(crate::WORKSPACE_ROOT_ID.to_string(), workspace.clone())
            .await?;
        backend
            .insert_domain(
                crate::WORKSPACE_ROOT_ID.to_string(),
                Domain::Workspace { workspace },
            )
            .await
    }
}
