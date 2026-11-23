//! "Plan & billing" over a member's session (`OpenBillingPortal`).
//!
//! The kernel decides WHO may open the portal; the host decides WHICH subscription it opens. The
//! caller is the session's own account (the one the transport authenticated), asked whether it
//! holds EditWorkspaceConfig at the workspace root, the permission the workspace's other
//! settings ask. The host is reached through [`BillingPortalHost`] and is asked nothing about the
//! caller or the tenant: a hosted tenant's object opens its own tenant's subscription, so a
//! request cannot point it at another. A kernel built without a host answers [`NOT_SUPPORTED`]
//! (a self-hosted server has no plan), and the portal is then opened with the claim code instead.

use citadel_workspace_types::billing::BillingPortalAnswer;
use citadel_workspace_types::WorkspaceProtocolResponse;
use std::sync::Arc;

/// The host could not be asked, or failed, and why. The detail is the host's to log.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BillingPortalUnavailable(pub String);

/// The host capability that opens this workspace's billing portal. Called only after the kernel
/// has admitted the caller.
#[async_trait::async_trait]
pub trait BillingPortalHost: Send + Sync {
    async fn open(&self) -> Result<BillingPortalAnswer, BillingPortalUnavailable>;
}

/// The capability as the kernel holds it: absent unless the host passed one.
pub type BillingPortalHandle = Option<Arc<dyn BillingPortalHost>>;

pub const NOT_SUPPORTED: &str = "this workspace server has no billing portal";
pub(crate) const BILLING_ONLY: &str =
    "Permission denied: EditWorkspaceConfig is required to manage this workspace's plan";

/// `OpenBillingPortal`, once it is known whether the caller may configure the workspace. A
/// caller who may not is refused before the host is asked anything.
pub async fn open(host: &BillingPortalHandle, may_configure: bool) -> WorkspaceProtocolResponse {
    let Some(host) = host else {
        return WorkspaceProtocolResponse::Error(NOT_SUPPORTED.to_string());
    };
    if !may_configure {
        return WorkspaceProtocolResponse::Error(BILLING_ONLY.to_string());
    }
    let answer = match host.open().await {
        Ok(answer) => answer,
        Err(BillingPortalUnavailable(reason)) => BillingPortalAnswer::Unavailable { reason },
    };
    WorkspaceProtocolResponse::BillingPortal(answer)
}
