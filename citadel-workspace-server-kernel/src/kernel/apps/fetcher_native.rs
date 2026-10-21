//! The native server's `ArtifactFetcher`: HTTPS through an injected `reqwest` client.
//!
//! `artifact_client` builds the client the server injects: rustls with Mozilla's roots, the
//! fetch timeout, redirects only to the same https host, and a resolver that answers only
//! public unicast addresses, so a listed location cannot point the server at its own network.
//! The resolver's answer is what the connection uses, so a second DNS answer cannot rebind it.

use super::fetcher::{admit_redirect, admit_url, ArtifactFetcher, FetchRefusal, FETCH_TIMEOUT_MS};
use citadel_app_net_policy::{classify, AddressClass};
use reqwest::dns::{Addrs, Name, Resolve, Resolving};
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

/// Only the public addresses among `resolved`.
pub fn public_only(resolved: impl IntoIterator<Item = SocketAddr>) -> Vec<SocketAddr> {
    resolved
        .into_iter()
        .filter(|addr| classify(addr.ip()) == AddressClass::Public)
        .collect()
}

struct PublicOnlyResolver;

impl Resolve for PublicOnlyResolver {
    fn resolve(&self, name: Name) -> Resolving {
        Box::pin(async move {
            let resolved = tokio::net::lookup_host((name.as_str(), 0)).await?;
            let public = public_only(resolved);
            if public.is_empty() {
                return Err("the name resolved to no public address".into());
            }
            let addrs: Addrs = Box::new(public.into_iter());
            Ok(addrs)
        })
    }
}

/// The client `NativeArtifactFetcher` is given in production.
pub fn artifact_client() -> Result<reqwest::Client, String> {
    let redirects = reqwest::redirect::Policy::custom(|attempt| {
        let hop = attempt.previous().len();
        let original = attempt.previous().first().map(|u| u.as_str().to_string());
        let verdict = original
            .ok_or_else(|| FetchRefusal::Redirect("no original request".to_string()))
            .and_then(|original| admit_url(&original))
            .and_then(|original| admit_redirect(&original, attempt.url().as_str(), hop));
        match verdict {
            Ok(()) => attempt.follow(),
            Err(why) => attempt.error(format!("{why:?}")),
        }
    });
    reqwest::Client::builder()
        .timeout(Duration::from_millis(FETCH_TIMEOUT_MS))
        .redirect(redirects)
        .https_only(true)
        .dns_resolver(Arc::new(PublicOnlyResolver))
        .build()
        .map_err(|e| format!("the artifact client could not be built: {e}"))
}

pub struct NativeArtifactFetcher {
    client: reqwest::Client,
}

impl NativeArtifactFetcher {
    pub fn new(client: reqwest::Client) -> Self {
        Self { client }
    }
}

#[async_trait::async_trait]
impl ArtifactFetcher for NativeArtifactFetcher {
    async fn fetch(&self, url: &str, max_bytes: u32) -> Result<Vec<u8>, FetchRefusal> {
        admit_url(url)?;
        let failed = |e: reqwest::Error| FetchRefusal::Failed(e.to_string());
        let mut response = self.client.get(url).send().await.map_err(failed)?;
        if !response.status().is_success() {
            return Err(FetchRefusal::Failed(format!(
                "status {}",
                response.status()
            )));
        }
        let cap = max_bytes as usize;
        if response
            .content_length()
            .is_some_and(|len| len > cap as u64)
        {
            return Err(FetchRefusal::TooLarge);
        }
        let mut body = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(failed)? {
            if body.len() + chunk.len() > cap {
                return Err(FetchRefusal::TooLarge);
            }
            body.extend_from_slice(&chunk);
        }
        Ok(body)
    }
}
