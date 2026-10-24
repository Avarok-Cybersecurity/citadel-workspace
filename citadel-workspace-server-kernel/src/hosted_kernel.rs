//! The kernel a hosted server runs (`run_server_on`), assembled from what its host gives: the
//! same `workspace_kernel` the native server builds, with the host's support-grant mirror, TURN
//! sink and app usage meter installed, handed to the host before the node starts.

use crate::config::ServerConfig;
use crate::kernel;
use crate::kernel::async_kernel::AsyncWorkspaceServerKernel;
use citadel_sdk::prelude::{BackendType, NetworkError, StackedRatchet};

/// The hosted kernel. Nothing is read from the environment: the first-connect decision and the
/// workspace structure are `config`'s alone, and every meter is the host's.
#[allow(clippy::too_many_arguments)]
pub(crate) async fn hosted_kernel(
    config: &ServerConfig,
    backend: &BackendType,
    ice_servers: kernel::ice_servers::IceServerSourceHandle,
    sign_in_settings: kernel::sign_in::SignInSettingsHandle,
    telemetry: kernel::telemetry::HostedTelemetry<StackedRatchet>,
    link_quota: kernel::secure_links::quota::LinkQuotaSourceHandle,
    artifact_fetcher: kernel::apps::fetcher::ArtifactFetcherHandle,
    server_egress: kernel::apps::egress::ServerEgressHandle,
) -> Result<AsyncWorkspaceServerKernel<StackedRatchet>, NetworkError> {
    let workspace_structure = crate::resolve_workspace_structure(config, None)?;
    let first_connect_admin =
        crate::resolve_first_connect_admin(None, config.allow_first_connect_admin)?;
    let mut kernel = crate::workspace_kernel(
        config,
        workspace_structure,
        first_connect_admin,
        ice_servers,
        sign_in_settings,
        link_quota,
        artifact_fetcher,
        server_egress,
        kernel::apps::storage_entitlement::StorageEntitlement::of(backend),
        telemetry.usage_meter,
    )
    .await?;
    kernel.set_support_grant_observer(telemetry.support_grants);
    kernel.set_turn_usage_sink(telemetry.turn_usage);
    (telemetry.kernel_ready)(kernel.clone());
    Ok(kernel)
}
