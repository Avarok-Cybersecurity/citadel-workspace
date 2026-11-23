//! `HostNetGrant`: a member's agent asks what an install may reach from the member's machine.
//!
//! Every refusal is the same `None`, so the answer tells the agent nothing about why: an install
//! that is not there, one that is suspended or does not reach the caller, an installer who no
//! longer holds `AppInstallAllowHostNetwork`, or an install the caller turned off for
//! themselves. The decision is `kernel::apps::host_net`; the servers and session limits are the
//! running release's manifest's, the one `install.manifest_sha256` names.

use super::apps::{answer, Answer, Caller};
use super::apps_gather::effective_for;
use crate::kernel::apps::facts::authority_node;
use crate::kernel::apps::host_net::host_net_grant;
use crate::kernel::async_kernel::AsyncWorkspaceServerKernel;
use crate::WORKSPACE_ROOT_ID;
use citadel_sdk::prelude::{NetworkError, Ratchet};
use citadel_workspace_types::apps_manifest::AppManifest;
use citadel_workspace_types::apps_responses::AppsResponse;

pub(super) async fn grant<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    caller: &Caller<'_>,
    install_id: &str,
    tag: u64,
) -> Answer {
    let backend = &kernel.domain_operations.backend_tx_manager;
    let grant = match backend.app_install(install_id).await? {
        None => None,
        Some(install) => {
            let authority = authority_node(&install.scope, WORKSPACE_ROOT_ID);
            let effective = effective_for(kernel, &install, caller.user, authority).await?;
            let mine = backend.user_apps(caller.user).await?;
            let missing =
                || NetworkError::msg(format!("The release of install {} is missing", install.id));
            let release = backend
                .app_release(&install.manifest_sha256)
                .await?
                .ok_or_else(missing)?;
            let running = AppManifest::from_bytes(release.manifest.as_bytes()).map_err(|why| {
                NetworkError::msg(format!("A stored manifest does not read: {why}"))
            })?;
            let disabled = mine.disabled.contains(&install.id);
            host_net_grant(&install, &running, &effective, disabled)
        }
    };
    answer(AppsResponse::HostNetGrant {
        install_id: install_id.to_string(),
        tag,
        grant,
    })
}
