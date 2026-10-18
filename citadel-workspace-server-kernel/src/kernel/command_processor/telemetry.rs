//! Terms, consent and the Telemetry Service: who may send which `TelemetryRequest`.
//!
//! The permission is checked before the request's contents are looked at, so a caller without
//! it is refused identically whatever they send.
//!
//! - Taking part (accepting terms, opting in, uploading) needs `ViewContent` on the workspace:
//!   a member who is not banned.
//! - Reading telemetry and its access log needs `ViewTelemetry`.
//! - The policy, the support grant and the workspace terms need `EditWorkspaceConfig`.
//! - Reading the terms and one's own consent, opting out and erasing one's own telemetry are
//!   open to every signed-in user, banned included: erasure must not depend on standing.

use crate::handlers::domain::async_ops::AsyncPermissionOperations;
use crate::kernel::async_kernel::AsyncWorkspaceServerKernel;
use crate::platform::{SystemTime, UNIX_EPOCH};
use crate::WorkspaceProtocolResponse;
use citadel_sdk::prelude::{NetworkError, Ratchet};
use citadel_workspace_types::structs::Permission;
use citadel_workspace_types::telemetry::TelemetryRequest;

fn required_permission(request: &TelemetryRequest) -> Option<Permission> {
    match request {
        TelemetryRequest::AcceptTerms { .. } | TelemetryRequest::UploadTelemetry { .. } => {
            Some(Permission::ViewContent)
        }
        TelemetryRequest::SetTelemetryConsent { enabled } => {
            enabled.then_some(Permission::ViewContent)
        }
        TelemetryRequest::ListTelemetry { .. }
        | TelemetryRequest::GetTelemetrySettings
        | TelemetryRequest::ListTelemetryAccessLog => Some(Permission::ViewTelemetry),
        TelemetryRequest::SetTelemetryPolicy { .. }
        | TelemetryRequest::SetSupportAccess { .. }
        | TelemetryRequest::SetWorkspaceTerms { .. } => Some(Permission::EditWorkspaceConfig),
        TelemetryRequest::GetTerms
        | TelemetryRequest::GetMyConsent
        | TelemetryRequest::DeleteMyTelemetry => None,
    }
}

/// The server's clock, in Unix ms.
pub(super) fn now_ms() -> Result<u64, NetworkError> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as u64)
        .map_err(|e| NetworkError::msg(format!("The server clock is before the epoch: {e}")))
}

pub(super) async fn process<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    actor_user_id: &str,
    request: &TelemetryRequest,
) -> Result<WorkspaceProtocolResponse, NetworkError> {
    if let Some(permission) = required_permission(request) {
        let allowed = kernel
            .domain_operations
            .check_entity_permission(actor_user_id, crate::WORKSPACE_ROOT_ID, permission)
            .await?;
        if !allowed {
            return Ok(WorkspaceProtocolResponse::Error(format!(
                "Permission denied: {permission:?} required"
            )));
        }
    }
    crate::kernel::telemetry::serve(kernel, actor_user_id, request, now_ms()?).await
}
