//! The native server's `EgressFetcher`: the system resolver, and reqwest pinned to the
//! addresses the policy checked.
//!
//! One client per exchange, built for that exchange's checked addresses: `resolve_to_addrs`
//! makes the name resolve to exactly those, so reqwest never asks DNS again and a second answer
//! cannot rebind the connection. No redirects (each is decided by the policy, in
//! `kernel::apps::egress`), no proxy (an environment `HTTPS_PROXY` would send the request
//! somewhere the policy never saw), no cookie store, https only.

use super::egress_port::{EgressAnswer, EgressFailure, EgressFetcher, PinnedRequest};
use std::net::IpAddr;
use std::time::Duration;

/// How long a name may take to resolve.
const RESOLVE_TIMEOUT_MS: u64 = 5_000;

pub struct NativeEgressFetcher;

fn failed(why: reqwest::Error) -> EgressFailure {
    if why.is_timeout() {
        EgressFailure::Timeout
    } else {
        EgressFailure::Network(why.to_string())
    }
}

#[async_trait::async_trait]
impl EgressFetcher for NativeEgressFetcher {
    async fn resolve(&self, host: &str, port: u16) -> Result<Vec<IpAddr>, String> {
        let lookup = tokio::net::lookup_host((host, port));
        let addresses = tokio::time::timeout(Duration::from_millis(RESOLVE_TIMEOUT_MS), lookup)
            .await
            .map_err(|_| "the name did not resolve in time".to_string())?
            .map_err(|why| why.to_string())?;
        Ok(addresses.map(|address| address.ip()).collect())
    }

    async fn exchange(
        &self,
        request: PinnedRequest,
        max_body: u64,
        timeout_ms: u64,
    ) -> Result<EgressAnswer, EgressFailure> {
        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .no_proxy()
            .https_only(true)
            .timeout(Duration::from_millis(timeout_ms))
            .resolve_to_addrs(&request.host, &request.connect)
            .build()
            .map_err(failed)?;
        let method = reqwest::Method::from_bytes(request.method.as_bytes())
            .map_err(|why| EgressFailure::Network(why.to_string()))?;
        let mut builder = client.request(method, &request.url);
        for (name, value) in &request.headers {
            builder = builder.header(name, value);
        }
        if !request.body.is_empty() {
            builder = builder.body(request.body);
        }
        let mut response = builder.send().await.map_err(failed)?;
        if response.content_length().is_some_and(|len| len > max_body) {
            return Err(EgressFailure::TooLarge);
        }
        let status = response.status().as_u16();
        let headers = response
            .headers()
            .iter()
            .filter_map(|(name, value)| {
                let value = value.to_str().ok()?;
                Some((name.as_str().to_string(), value.to_string()))
            })
            .collect();
        let mut body = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(failed)? {
            if (body.len() + chunk.len()) as u64 > max_body {
                return Err(EgressFailure::TooLarge);
            }
            body.extend_from_slice(&chunk);
        }
        Ok(EgressAnswer {
            status,
            headers,
            body,
        })
    }
}
