//! Fetching an artifact from the locations its manifest lists: a host capability.
//!
//! Fetching is I/O the host does (a Durable Object's `fetch`, a native server's HTTPS client),
//! so the host passes an `ArtifactFetcher` when it builds the kernel. A kernel built with none
//! refuses to install or publish an artifact it does not hold with `ServerFeatureUnavailable`;
//! an upload still works. Whatever a fetcher returns, the kernel checks the size and digest
//! itself, and the signature was checked before anything was fetched: a location is a hint,
//! the digest is the identity.
//!
//! The policy every fetcher keeps, defined once here: https only, the URL in the strict shape
//! the egress policy reads, at most `MAX_ARTIFACT_BYTES`, `FETCH_TIMEOUT_MS`, and redirects only
//! to the same host, at most `MAX_FETCH_REDIRECTS`.

use citadel_app_net_policy::{Scheme, TargetUrl};
use citadel_workspace_types::apps_manifest::ArtifactLocation;
use citadel_workspace_types::apps_manifest_check_parts::MAX_ARTIFACT_BYTES;
use std::sync::Arc;

pub const FETCH_TIMEOUT_MS: u64 = 15_000;
pub const MAX_FETCH_REDIRECTS: usize = 3;
pub const MAX_FETCH_BYTES: u32 = MAX_ARTIFACT_BYTES;

/// Why a location gave nothing. The detail is for the operator's log, never the member.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FetchRefusal {
    /// Not an https URL the policy reads.
    Url(String),
    /// A redirect off the host, a downgrade, or too many.
    Redirect(String),
    /// The body is larger than the cap.
    TooLarge,
    /// The network, the remote, or the timeout.
    Failed(String),
}

/// The host capability that fetches artifact bytes.
#[async_trait::async_trait]
pub trait ArtifactFetcher: Send + Sync {
    /// The body at `url`, which `admit_url` accepted, of at most `max_bytes`.
    async fn fetch(&self, url: &str, max_bytes: u32) -> Result<Vec<u8>, FetchRefusal>;
}

/// The capability as the kernel holds it: absent unless the host passed one.
pub type ArtifactFetcherHandle = Option<Arc<dyn ArtifactFetcher>>;

/// The URL a location is fetched from.
pub fn location_url(location: &ArtifactLocation) -> String {
    match location {
        ArtifactLocation::Https { url } => url.clone(),
        ArtifactLocation::GithubPinned { repo, commit, path } => {
            format!("https://raw.githubusercontent.com/{repo}/{commit}/{path}")
        }
    }
}

/// `url` parsed, if it is https in the shape the policy reads.
pub fn admit_url(url: &str) -> Result<TargetUrl, FetchRefusal> {
    let target = TargetUrl::parse(url).map_err(|fault| FetchRefusal::Url(format!("{fault:?}")))?;
    if target.scheme != Scheme::Https {
        return Err(FetchRefusal::Url("not https".to_string()));
    }
    Ok(target)
}

/// Whether a redirect from `original` to `next`, the `hop`th (from 1), may be followed.
pub fn admit_redirect(original: &TargetUrl, next: &str, hop: usize) -> Result<(), FetchRefusal> {
    if hop > MAX_FETCH_REDIRECTS {
        return Err(FetchRefusal::Redirect("too many redirects".to_string()));
    }
    let target = admit_url(next).map_err(|_| FetchRefusal::Redirect("not https".to_string()))?;
    if target.host != original.host {
        return Err(FetchRefusal::Redirect("off the host".to_string()));
    }
    Ok(())
}
