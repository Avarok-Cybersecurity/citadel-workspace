//! "Plan & billing" as the Durable Object opens it (kernel `billing::BillingPortalHost`).
//!
//! The kernel has already admitted the caller (EditWorkspaceConfig, from the session's own
//! account) when it asks. The object is asked with no argument and opens its OWN tenant's portal
//! (control/billing-portal.mjs): nothing on this side names a tenant, so no request can point it
//! at another. Its Promise resolves to `{portal_url}` or `{refused: "<code>"}`, the codes being
//! the control plane's own (control/billing-portal.mjs).
//!
//! The method rides on the sign-in host object, the one the kernel already calls for workspace
//! configuration it has permission-checked (`storeSettings`): a host object of its own would need
//! another hand-asserted `Send` wrapper.

use crate::host_promise::{parse, HostPromise};
use crate::sign_in::{DurableObjectSignIn, SignInHost};
use citadel_sdk::prelude::async_trait;
use citadel_workspace_server_kernel::kernel::billing::{
    BillingPortalHost, BillingPortalUnavailable,
};
use citadel_workspace_types::billing::BillingPortalAnswer;
use serde::Deserialize;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(method, catch, js_name = openBillingPortal)]
    fn open_billing_portal(this: &SignInHost) -> Result<js_sys::Promise, JsValue>;
}

/// What the object's Promise resolves to.
#[derive(Deserialize)]
#[serde(untagged)]
enum HostAnswer {
    Opened { portal_url: String },
    Refused { refused: String },
}

/// Said to the member when the host failed rather than declined; the object logs the detail.
const HOST_FAILED: &str = "billing could not be reached just now";

fn failed(detail: String) -> BillingPortalUnavailable {
    web_sys::console::error_1(&format!("[tenant] billing portal host failed: {detail}").into());
    BillingPortalUnavailable(HOST_FAILED.to_string())
}

/// The answer for a refusal code; a code this side does not know is a host failure, never a
/// guess at what it meant.
fn refused(code: &str) -> Result<BillingPortalAnswer, BillingPortalUnavailable> {
    match code {
        "no-subscription" => Ok(BillingPortalAnswer::NoSubscription),
        "portal-not-configured" | "billing-not-configured" => {
            Ok(BillingPortalAnswer::NotConfigured)
        }
        other => Err(failed(format!("unknown refusal {other:?}"))),
    }
}

#[async_trait]
impl BillingPortalHost for DurableObjectSignIn {
    async fn open(&self) -> Result<BillingPortalAnswer, BillingPortalUnavailable> {
        let promise = HostPromise::from_call(self.0.open_billing_portal()).map_err(failed)?;
        let value = promise.await.map_err(|e| failed(format!("{e:?}")))?;
        match parse::<HostAnswer>(&value).map_err(failed)? {
            HostAnswer::Opened { portal_url } => Ok(BillingPortalAnswer::Opened { portal_url }),
            HostAnswer::Refused { refused: code } => refused(&code),
        }
    }
}
