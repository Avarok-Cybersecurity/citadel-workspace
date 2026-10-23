//! The Telemetry Service: terms acceptance, opt-in consent, and agent logs kept in the
//! workspace's own backend for its admins (and, with their grant, Avarok support) to read.
//!
//! `rules` decides, `store` reads and writes, `service` and `reads` sequence the two. The
//! kernel's request handler (`command_processor::telemetry`) gates each request; the methods
//! below are the host's entry points, for a Durable Object alarm and the support read.

mod entry_rules;
mod reads;
mod records;
mod rules;
mod service;
mod store;

use crate::kernel::async_kernel::AsyncWorkspaceServerKernel;
use crate::WorkspaceProtocolResponse;
use citadel_sdk::prelude::{NetworkError, Ratchet};
use citadel_workspace_types::telemetry::{
    SupportAccess, TelemetryAccessor, TelemetryFilter, TelemetryPage, TelemetryRequest,
};
use std::sync::Arc;
use store::TelemetryStore;

/// The host's record of which workspaces Avarok support may read (the control plane lists them).
/// Told the stored grant after every change an admin makes. It is a mirror for listing only:
/// `support_list_telemetry` checks the kernel's own record on every read.
#[async_trait::async_trait]
pub trait SupportGrantObserver: Send + Sync {
    async fn support_access_changed(&self, access: SupportAccess);
}

/// The observer as the kernel holds it: absent unless the host passed one.
pub type SupportGrantObserverHandle = Option<Arc<dyn SupportGrantObserver>>;

/// What a host that serves support reads gives the kernel: the grant observer, and a callback
/// handed a clone of the kernel once it is built, for the host's alarm
/// (`purge_expired_telemetry`) and verified support reads (`support_list_telemetry`).
pub struct HostedTelemetry<R: Ratchet> {
    pub support_grants: SupportGrantObserverHandle,
    pub kernel_ready: Box<dyn FnOnce(AsyncWorkspaceServerKernel<R>)>,
}

/// Serialises every Telemetry Service read-modify-write. Each index, the user list and the
/// access log are one record each, so two writers interleaving would lose one's change. The
/// service is low-traffic (periodic uploads, admin reads), so one lock for all of it.
static TELEMETRY_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

/// Serve an already-authorised request from `user_id`.
pub(crate) async fn serve<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    user_id: &str,
    request: &TelemetryRequest,
    now_ms: u64,
) -> Result<WorkspaceProtocolResponse, NetworkError> {
    let Some(platform_terms_required) = kernel.platform_terms_required() else {
        return Ok(WorkspaceProtocolResponse::Error(
            "This server does not say whether Avarok's platform terms apply to it".to_string(),
        ));
    };
    let store = TelemetryStore::new(
        &kernel.domain_operations.backend_tx_manager,
        platform_terms_required,
    );
    let _guard = TELEMETRY_LOCK.lock().await;
    match request {
        TelemetryRequest::AcceptTerms {
            platform_version,
            workspace_version,
        } => {
            service::accept_terms(
                &store,
                user_id,
                *platform_version,
                *workspace_version,
                now_ms,
            )
            .await
        }
        TelemetryRequest::GetTerms => Ok(WorkspaceProtocolResponse::Telemetry(
            citadel_workspace_types::telemetry::TelemetryResponse::Terms(
                service::current_terms(&store).await?,
            ),
        )),
        TelemetryRequest::GetMyConsent => service::my_consent(&store, user_id).await,
        TelemetryRequest::SetTelemetryConsent { enabled } => {
            service::set_consent(&store, user_id, *enabled, now_ms).await
        }
        TelemetryRequest::UploadTelemetry { batch } => {
            service::upload(&store, user_id, batch, now_ms).await
        }
        TelemetryRequest::ListTelemetry { filter, page } => {
            let accessor = TelemetryAccessor::Member {
                user_id: user_id.to_string(),
            };
            reads::list(&store, accessor, filter, page, now_ms).await
        }
        TelemetryRequest::DeleteMyTelemetry => {
            let segments = service::delete_user(&store, user_id).await?;
            Ok(WorkspaceProtocolResponse::Telemetry(
                citadel_workspace_types::telemetry::TelemetryResponse::Deleted { segments },
            ))
        }
        TelemetryRequest::GetTelemetrySettings => reads::settings(&store).await,
        TelemetryRequest::SetTelemetryPolicy {
            retention_days,
            per_user_bytes,
        } => reads::set_policy(&store, *retention_days, *per_user_bytes, now_ms).await,
        TelemetryRequest::SetSupportAccess { enabled, until_ms } => {
            let response = reads::set_support_access(&store, *enabled, *until_ms, now_ms).await?;
            if let (Some(observer), false) = (
                kernel.support_grant_observer(),
                matches!(response, WorkspaceProtocolResponse::Error(_)),
            ) {
                observer
                    .support_access_changed(store.support_access().await?)
                    .await;
            }
            Ok(response)
        }
        TelemetryRequest::ListTelemetryAccessLog => reads::access_log(&store).await,
        TelemetryRequest::SetWorkspaceTerms { text } => {
            service::set_workspace_terms(&store, text.as_deref()).await
        }
    }
}

impl<R: Ratchet + Send + Sync + 'static> AsyncWorkspaceServerKernel<R> {
    /// Drop every segment past retention or over its user's cap, as of `now_ms` (Unix ms, the
    /// host's clock). For the tenant's daily alarm; uploads enforce the same on write.
    /// Returns the number of segments removed.
    pub async fn purge_expired_telemetry(&self, now_ms: u64) -> Result<u32, NetworkError> {
        let store = TelemetryStore::new(
            &self.domain_operations.backend_tx_manager,
            self.platform_terms_required().unwrap_or(false),
        );
        let _guard = TELEMETRY_LOCK.lock().await;
        let policy = store.policy().await?;
        service::enforce_policy(&store, &policy, now_ms).await
    }

    /// The `ListTelemetry` query for Avarok support, which the host calls only after verifying
    /// the signed support request. Refused unless the admin's grant is on and unexpired at
    /// `now_ms`; a served read is written to the access log with `TelemetryAccessor::Support`.
    pub async fn support_list_telemetry(
        &self,
        filter: &TelemetryFilter,
        page: &TelemetryPage,
        now_ms: u64,
    ) -> Result<WorkspaceProtocolResponse, NetworkError> {
        let store = TelemetryStore::new(
            &self.domain_operations.backend_tx_manager,
            self.platform_terms_required().unwrap_or(false),
        );
        let _guard = TELEMETRY_LOCK.lock().await;
        if !rules::support_access_active(&store.support_access().await?, now_ms) {
            return Ok(WorkspaceProtocolResponse::Error(
                "Support access is not granted for this workspace".to_string(),
            ));
        }
        reads::list(&store, TelemetryAccessor::Support, filter, page, now_ms).await
    }
}
