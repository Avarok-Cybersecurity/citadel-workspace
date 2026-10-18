//! Secure links: the object's link limits, and its purge alarm's entry into the kernel.
//!
//! The object passes an object whose `quota()` returns `{per_member, pool}` from the tenant's
//! entitlements, or throws when it cannot (control/tenant-links.mjs). The kernel asks on every
//! create and list, so a plan change applies at once.

use crate::support::millis;
use crate::TenantServer;
use citadel_workspace_server_kernel::kernel::secure_links::quota::{
    LinkQuota, LinkQuotaSource, LinkQuotaUnavailable,
};
use citadel_workspace_server_kernel::kernel::secure_links::PURGE_BATCH;
use js_sys::Promise;
use serde::Deserialize;
use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::future_to_promise;

#[wasm_bindgen]
extern "C" {
    /// The object the Durable Object hands in; see the module docs.
    pub type LinkQuotaHost;

    #[wasm_bindgen(method, catch)]
    fn quota(this: &LinkQuotaHost) -> Result<JsValue, JsValue>;
}

#[derive(Deserialize)]
struct HostQuota {
    per_member: u32,
    pool: u32,
}

struct DurableObjectLinkQuota(LinkQuotaHost);

// SAFETY: wasm32 without threads has one thread, and each Durable Object gets its own wasm
// instance (see worker.mjs), so this handle is never reached from another thread or object.
unsafe impl Send for DurableObjectLinkQuota {}
unsafe impl Sync for DurableObjectLinkQuota {}

/// The kernel's link-limit source over `host`.
pub fn source(host: LinkQuotaHost) -> std::sync::Arc<dyn LinkQuotaSource> {
    std::sync::Arc::new(DurableObjectLinkQuota(host))
}

impl LinkQuotaSource for DurableObjectLinkQuota {
    fn quota(&self) -> Result<LinkQuota, LinkQuotaUnavailable> {
        let value = self
            .0
            .quota()
            .map_err(|e| LinkQuotaUnavailable(format!("{e:?}")))?;
        let HostQuota { per_member, pool } = crate::host_promise::parse(&value)
            .map_err(LinkQuotaUnavailable)?;
        Ok(LinkQuota { per_member, pool })
    }
}

#[wasm_bindgen]
impl TenantServer {
    /// Resolves to how many expired links remain after removing at most one batch of those
    /// expired as of `now_ms`. The object runs another pass soon when it is not zero.
    pub fn purge_expired_links(&self, now_ms: f64) -> Promise {
        let ready = self.ready_kernel();
        future_to_promise(async move {
            let kernel = ready?;
            let remaining = kernel
                .purge_expired_links(millis(now_ms).map_err(JsValue::from)?, PURGE_BATCH)
                .await
                .map_err(|e| JsError::new(&format!("secure-link purge failed: {e:?}")))?;
            Ok(remaining.into())
        })
    }
}
