//! Relay credentials, minted by the Durable Object.
//!
//! The object passes an object whose `mint(memberId)` returns a Promise of either
//! `{ice_servers: [{urls, username, credential}], expires_at}` or `{unavailable: "<reason>"}`
//! (worker.mjs, control/ice.mjs). The TURN provider's API key stays in the object: this side
//! sees only the short-lived credentials, which the kernel returns over the member's session.

use citadel_sdk::prelude::async_trait;
use citadel_workspace_server_kernel::kernel::ice_servers::{
    IceServerGrant, IceServerMember, IceServerSource, IceServersUnavailable,
};
use citadel_workspace_types::ice::IceServer;
use serde::Deserialize;
use std::future::Future;
use std::pin::Pin;
use std::task::{Context, Poll};
use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::JsFuture;

#[wasm_bindgen]
extern "C" {
    /// The object the Durable Object hands in; see the module docs.
    pub type IceHost;

    #[wasm_bindgen(method, catch)]
    fn mint(this: &IceHost, member_id: &str) -> Result<js_sys::Promise, JsValue>;
}

/// What the host's Promise resolves to.
#[derive(Deserialize)]
#[serde(untagged)]
enum HostAnswer {
    Granted {
        ice_servers: Vec<IceServer>,
        expires_at: u64,
    },
    Unavailable {
        unavailable: String,
    },
}

/// Said to the member when the host failed rather than declined; the object logs the detail.
const HOST_FAILED: &str = "the relay service could not be reached";

struct DurableObjectIce(IceHost);

// SAFETY: wasm32 without threads has one thread, and each Durable Object gets its own wasm
// instance (see worker.mjs), so this handle is never reached from another thread or object.
unsafe impl Send for DurableObjectIce {}
unsafe impl Sync for DurableObjectIce {}

/// A host Promise, awaitable where the kernel requires `Send` futures.
struct HostPromise(JsFuture);

// SAFETY: as for `DurableObjectIce`: one thread, one object per instance.
unsafe impl Send for HostPromise {}

impl Future for HostPromise {
    type Output = Result<JsValue, JsValue>;
    fn poll(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Self::Output> {
        Pin::new(&mut self.0).poll(cx)
    }
}

/// The kernel's relay-credential source over `host`.
pub fn source(host: IceHost) -> std::sync::Arc<dyn IceServerSource> {
    std::sync::Arc::new(DurableObjectIce(host))
}

fn parse(value: &JsValue) -> Result<HostAnswer, String> {
    let text = js_sys::JSON::stringify(value)
        .map_err(|e| format!("unserialisable answer: {e:?}"))?
        .as_string()
        .ok_or("the answer is not JSON")?;
    serde_json::from_str(&text).map_err(|e| format!("malformed answer: {e}"))
}

impl DurableObjectIce {
    fn promise(&self, member_id: &str) -> Result<HostPromise, String> {
        let promise = self.0.mint(member_id).map_err(|e| format!("{e:?}"))?;
        Ok(HostPromise(JsFuture::from(promise)))
    }
}

#[async_trait]
impl IceServerSource for DurableObjectIce {
    async fn mint(
        &self,
        member: &IceServerMember,
    ) -> Result<IceServerGrant, IceServersUnavailable> {
        let failed = |detail: String| {
            web_sys::console::error_1(
                &format!("[tenant] relay credential host failed: {detail}").into(),
            );
            IceServersUnavailable(HOST_FAILED.to_string())
        };
        let promise = self.promise(&member.user_id).map_err(failed)?;
        let answer = promise
            .await
            .map_err(|e| format!("{e:?}"))
            .and_then(|value| parse(&value))
            .map_err(failed)?;
        match answer {
            HostAnswer::Granted {
                ice_servers,
                expires_at,
            } => Ok(IceServerGrant {
                ice_servers,
                expires_at,
            }),
            HostAnswer::Unavailable { unavailable } => Err(IceServersUnavailable(unavailable)),
        }
    }
}
