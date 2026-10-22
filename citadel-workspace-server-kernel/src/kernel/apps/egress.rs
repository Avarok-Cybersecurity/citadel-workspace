//! Server egress (`net.server`): an app's HTTPS request, made by the workspace server.
//!
//! The decisions are here; the I/O is the host's `EgressFetcher` (a native HTTPS client, or a
//! hosted runtime's own), injected like the artifact fetcher. Every request goes through
//! `ServerEgress::fetch`: the rate limit, then the shared SSRF policy
//! (`citadel_app_net_policy::decide`) before any name is resolved, then the fetcher's
//! resolver, then the policy again over every address, then one exchange pinned to the checked
//! addresses and nowhere else. A redirect is decided again (same host, at most three), and
//! resolved and pinned again. Whatever the policy refuses is the one `Policy` refusal, before
//! the fetcher is asked to connect anywhere.

pub use super::egress_port::{EgressAnswer, EgressFailure, EgressFetcher, PinnedRequest};
use crate::platform::Instant;
use citadel_app_net_policy::{
    decide, decide_redirect, Allowed, DenyReason, Deployment, Egress, EgressRequest, NetGrant,
    Scheme, TargetUrl, Verdict, MAX_REQUESTS_PER_MINUTE, MAX_RESPONSE_BODY_BYTES, POLICY_REFUSAL,
    REQUEST_TIMEOUT_MS,
};
use citadel_app_sdk_types::calls::{HttpMethod, HttpRequest, HttpResponse};
use citadel_app_sdk_types::Refused;
use citadel_logging::info;
use parking_lot::Mutex;
use std::collections::{HashMap, VecDeque};
use std::net::IpAddr;
use std::sync::Arc;

/// Statuses whose `location` is followed, and decided again.
const REDIRECT_STATUSES: [u16; 5] = [301, 302, 303, 307, 308];
const MINUTE_MS: u64 = 60_000;

/// Who a request is counted against: `(install id, acting member)`.
pub type RateKey = (String, String);

/// Server egress as the kernel holds it: the host's fetcher, the deployment's own addresses
/// (which no grant reaches), and the per-install-per-member rate window.
pub struct ServerEgress {
    fetcher: Arc<dyn EgressFetcher>,
    deployment: Deployment,
    window: Mutex<HashMap<RateKey, VecDeque<u64>>>,
}

/// Absent unless the host passed one: `net.server` is then answered `Unavailable`.
pub type ServerEgressHandle = Option<Arc<ServerEgress>>;

fn method_name(method: &HttpMethod) -> &'static str {
    match method {
        HttpMethod::Get => "GET",
        HttpMethod::Post => "POST",
        HttpMethod::Put => "PUT",
        HttpMethod::Delete => "DELETE",
        HttpMethod::Patch => "PATCH",
        HttpMethod::Head => "HEAD",
    }
}

fn target_url(target: &TargetUrl) -> String {
    let scheme = match target.scheme {
        Scheme::Https => "https",
        Scheme::Http => "http",
    };
    format!(
        "{scheme}://{}:{}{}",
        target.host, target.port, target.path_and_query
    )
}

fn policy(install: &str, reason: &DenyReason) -> Refused {
    // For the operator's log; the app is told `policy` and nothing else.
    info!(target: "citadel", "[APP-EGRESS] {install}: refused by policy: {reason:?}");
    Refused::Policy(POLICY_REFUSAL.to_string())
}

impl ServerEgress {
    pub fn new(fetcher: Arc<dyn EgressFetcher>, deployment: Deployment) -> Self {
        Self {
            fetcher,
            deployment,
            window: Mutex::new(HashMap::new()),
        }
    }

    /// Whether `key` may make one more request at `now_ms`; forgets windows gone quiet.
    fn admit(&self, key: &RateKey, now_ms: u64) -> bool {
        let mut window = self.window.lock();
        let since = now_ms.saturating_sub(MINUTE_MS);
        window.retain(|_, times| {
            times.retain(|t| *t > since);
            !times.is_empty()
        });
        let times = window.entry(key.clone()).or_default();
        if times.len() >= MAX_REQUESTS_PER_MINUTE as usize {
            return false;
        }
        times.push_back(now_ms);
        true
    }

    /// `request` under `hosts` (the install's `net.server` hosts), as the app is answered.
    pub async fn fetch(
        &self,
        key: &RateKey,
        hosts: &[String],
        request: &HttpRequest,
        now_ms: u64,
    ) -> Result<HttpResponse, Refused> {
        let install = key.0.as_str();
        if !self.admit(key, now_ms) {
            return Err(Refused::Limit("rate".to_string()));
        }
        let entries: Vec<&str> = hosts.iter().map(String::as_str).collect();
        let grant = NetGrant::new(Egress::Server, &entries).map_err(|fault| {
            info!(target: "citadel", "[APP-EGRESS] {install}: unusable grant: {fault:?}");
            Refused::Policy(POLICY_REFUSAL.to_string())
        })?;
        let started = Instant::now();
        let mut method = method_name(&request.method).to_string();
        let mut body = request.body.0.clone();
        let mut url = request.url.clone();
        let mut previous: Option<Allowed> = None;
        let mut hop: u8 = 0;
        loop {
            let asked = EgressRequest {
                method: &method,
                url: &url,
                headers: &request.headers,
                body_len: body.len() as u64,
            };
            let allowed = self
                .check(install, &asked, previous.as_ref(), hop, &grant)
                .await?;
            let elapsed = u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX);
            let remaining = REQUEST_TIMEOUT_MS.saturating_sub(elapsed);
            if remaining == 0 {
                return Err(Refused::Limit("time".to_string()));
            }
            let pinned = PinnedRequest {
                method: method.clone(),
                url: target_url(&allowed.target),
                host: allowed.target.host.clone(),
                connect: allowed.connect.clone(),
                headers: request.headers.clone(),
                body: body.clone(),
            };
            let answer = self
                .fetcher
                .exchange(pinned, MAX_RESPONSE_BODY_BYTES, remaining)
                .await
                .map_err(|failure| match failure {
                    EgressFailure::TooLarge => Refused::Limit("response_bytes".to_string()),
                    EgressFailure::Timeout => Refused::Limit("time".to_string()),
                    EgressFailure::Network(why) => {
                        info!(target: "citadel", "[APP-EGRESS] {install}: upstream failed: {why}");
                        Refused::Unavailable("network".to_string())
                    }
                })?;
            let location = REDIRECT_STATUSES
                .contains(&answer.status)
                .then(|| answer.headers.iter().find(|(n, _)| n == "location"))
                .flatten()
                .map(|(_, v)| v.clone());
            let Some(location) = location else {
                if answer.body.len() as u64 > MAX_RESPONSE_BODY_BYTES {
                    return Err(Refused::Limit("response_bytes".to_string()));
                }
                // Metered as the server's `bytes_in`; logged for the operator until the
                // host's meter takes it (see the module docs of `kernel::apps`).
                info!(target: "citadel", "[APP-EGRESS] {install}: {} bytes in", answer.body.len());
                return Ok(HttpResponse {
                    status: answer.status,
                    headers: answer.headers,
                    body: answer.body.into(),
                });
            };
            url = allowed.follow(&location);
            if answer.status == 303 || (matches!(answer.status, 301 | 302) && method == "POST") {
                method = "GET".to_string();
                body.clear();
            }
            previous = Some(allowed);
            hop = hop.saturating_add(1);
        }
    }

    fn decide_hop(
        &self,
        asked: &EgressRequest<'_>,
        previous: Option<&Allowed>,
        hop: u8,
        resolved: &[IpAddr],
        grant: &NetGrant,
    ) -> Verdict {
        match previous {
            None => decide(asked, resolved, grant, &self.deployment),
            Some(previous) => {
                decide_redirect(previous, hop, asked, resolved, grant, &self.deployment)
            }
        }
    }

    /// Decide before resolving (a name the grant does not admit is never looked up), then
    /// resolve and decide every address.
    async fn check(
        &self,
        install: &str,
        asked: &EgressRequest<'_>,
        previous: Option<&Allowed>,
        hop: u8,
        grant: &NetGrant,
    ) -> Result<Allowed, Refused> {
        match self.decide_hop(asked, previous, hop, &[], grant) {
            Verdict::Allow(allowed) => Ok(allowed),
            Verdict::Policy(DenyReason::NoAddress) => {
                let target = TargetUrl::parse(asked.url)
                    .map_err(|fault| policy(install, &DenyReason::Url(fault)))?;
                let resolved = self
                    .fetcher
                    .resolve(&target.host, target.port)
                    .await
                    .unwrap_or_default();
                match self.decide_hop(asked, previous, hop, &resolved, grant) {
                    Verdict::Allow(allowed) => Ok(allowed),
                    Verdict::Policy(reason) => Err(policy(install, &reason)),
                }
            }
            Verdict::Policy(reason) => Err(policy(install, &reason)),
        }
    }
}
