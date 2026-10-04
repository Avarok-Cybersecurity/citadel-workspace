//! A Promise the Durable Object returns, awaited where the kernel's host traits require `Send`
//! futures, and its value read as JSON. Shared by every host capability (ice.rs, sign_in.rs).

use std::future::Future;
use std::pin::Pin;
use std::task::{Context, Poll};
use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::JsFuture;

/// A host Promise, awaitable where the kernel requires `Send` futures.
pub struct HostPromise(JsFuture);

// SAFETY: wasm32 without threads has one thread, and each Durable Object gets its own wasm
// instance (see worker.mjs), so this future is never reached from another thread or object.
unsafe impl Send for HostPromise {}

impl HostPromise {
    /// The Promise a host method returned, or why it could not be called.
    pub fn from_call(called: Result<js_sys::Promise, JsValue>) -> Result<Self, String> {
        called
            .map(|promise| Self(JsFuture::from(promise)))
            .map_err(|e| format!("{e:?}"))
    }
}

impl Future for HostPromise {
    type Output = Result<JsValue, JsValue>;
    fn poll(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Self::Output> {
        Pin::new(&mut self.0).poll(cx)
    }
}

/// A resolved value, read as `T` through its JSON form.
pub fn parse<T: serde::de::DeserializeOwned>(value: &JsValue) -> Result<T, String> {
    let text = js_sys::JSON::stringify(value)
        .map_err(|e| format!("unserialisable answer: {e:?}"))?
        .as_string()
        .ok_or("the answer is not JSON")?;
    serde_json::from_str(&text).map_err(|e| format!("malformed answer: {e}"))
}
