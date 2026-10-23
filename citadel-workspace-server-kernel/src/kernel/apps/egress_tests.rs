//! Server egress decisions, against a host that records what it was asked.
//!
//! The fetcher is a stand-in for the network: DNS and HTTPS cannot run in a unit test, and
//! what is under test is what the kernel asks of the host (which names it resolves, which
//! addresses it connects to) and what it answers the app. Everything else is the real code.

use super::egress::*;
use citadel_app_net_policy::{Deployment, MAX_REQUESTS_PER_MINUTE};
use citadel_app_sdk_types::calls::{HttpMethod, HttpRequest};
use citadel_app_sdk_types::Refused;
use parking_lot::Mutex;
use std::collections::HashMap;
use std::net::{IpAddr, SocketAddr};
use std::sync::Arc;

#[derive(Default)]
pub(crate) struct RecordingHost {
    pub names: HashMap<String, Vec<IpAddr>>,
    /// URL to the answer it gets.
    pub answers: HashMap<String, EgressAnswer>,
    pub resolved: Mutex<Vec<String>>,
    pub exchanged: Mutex<Vec<PinnedRequest>>,
}

#[async_trait::async_trait]
impl EgressFetcher for RecordingHost {
    async fn resolve(&self, host: &str, _port: u16) -> Result<Vec<IpAddr>, String> {
        self.resolved.lock().push(host.to_string());
        self.names
            .get(host)
            .cloned()
            .ok_or("no such name".to_string())
    }

    async fn exchange(
        &self,
        request: PinnedRequest,
        _max_body: u64,
        _timeout_ms: u64,
    ) -> Result<EgressAnswer, EgressFailure> {
        let answer = self.answers.get(&request.url).cloned();
        self.exchanged.lock().push(request);
        answer.ok_or(EgressFailure::Network("refused".to_string()))
    }
}

pub(crate) fn answer(status: u16, location: Option<&str>, body: &[u8]) -> EgressAnswer {
    EgressAnswer {
        status,
        headers: location
            .map(|l| vec![("location".to_string(), l.to_string())])
            .unwrap_or_default(),
        body: body.to_vec(),
    }
}

pub(crate) fn get(url: &str) -> HttpRequest {
    HttpRequest {
        method: HttpMethod::Get,
        url: url.to_string(),
        headers: vec![],
        body: Vec::new().into(),
    }
}

fn public() -> IpAddr {
    "93.184.216.34".parse().expect("ip")
}

fn egress(host: RecordingHost) -> (ServerEgress, Arc<RecordingHost>) {
    let host = Arc::new(host);
    let deployment = Deployment {
        page_origin_host: "acme.work.example".to_string(),
    };
    (ServerEgress::new(host.clone(), deployment), host)
}

fn key() -> RateKey {
    ("install-1".to_string(), "alice".to_string())
}

/// Both listed: a redirect from one to the other is still off its host.
const HOSTS: &[&str] = &["api.acme.example", "cdn.acme.example"];

fn hosts() -> Vec<String> {
    HOSTS.iter().map(|h| h.to_string()).collect()
}

#[tokio::test]
async fn an_allowed_request_connects_only_to_the_checked_addresses() {
    let mut host = RecordingHost::default();
    host.names.insert("api.acme.example".into(), vec![public()]);
    let url = "https://api.acme.example:443/v1/cards";
    host.answers.insert(url.into(), answer(200, None, b"[]"));
    let (egress, host) = egress(host);
    let reply = egress
        .fetch(
            &key(),
            &hosts(),
            &get("https://api.acme.example/v1/cards"),
            0,
        )
        .await;
    assert_eq!(reply.expect("ok").body.0, b"[]");
    let exchanged = host.exchanged.lock();
    assert_eq!(exchanged.len(), 1);
    assert_eq!(exchanged[0].connect, vec![SocketAddr::new(public(), 443)]);
    assert_eq!(exchanged[0].host, "api.acme.example");
}

#[tokio::test]
async fn a_name_that_resolves_to_a_private_address_is_refused_before_connecting() {
    let mut host = RecordingHost::default();
    let private: IpAddr = "10.0.0.5".parse().expect("ip");
    host.names
        .insert("api.acme.example".into(), vec![public(), private]);
    let (egress, host) = egress(host);
    let reply = egress
        .fetch(&key(), &hosts(), &get("https://api.acme.example/x"), 0)
        .await;
    assert_eq!(reply, Err(Refused::Policy("policy".to_string())));
    assert!(host.exchanged.lock().is_empty());
}

#[tokio::test]
async fn a_host_outside_the_grant_is_never_even_resolved() {
    let (egress, host) = egress(RecordingHost::default());
    for url in [
        "https://evil.example/x",
        "https://acme.work.example/x",
        "https://local.avarok.net/x",
        "http://api.acme.example/x",
    ] {
        let reply = egress.fetch(&key(), &hosts(), &get(url), 0).await;
        assert_eq!(reply, Err(Refused::Policy("policy".to_string())), "{url}");
    }
    assert!(host.resolved.lock().is_empty());
    assert!(host.exchanged.lock().is_empty());
}

#[tokio::test]
async fn a_redirect_is_followed_on_the_same_host_only_and_decided_again() {
    let mut host = RecordingHost::default();
    host.names.insert("api.acme.example".into(), vec![public()]);
    host.answers.insert(
        "https://api.acme.example:443/a".into(),
        answer(302, Some("/b"), b""),
    );
    host.answers.insert(
        "https://api.acme.example:443/b".into(),
        answer(200, None, b"b"),
    );
    host.answers.insert(
        "https://api.acme.example:443/off".into(),
        answer(302, Some("https://cdn.acme.example/c"), b""),
    );
    host.names.insert("cdn.acme.example".into(), vec![public()]);
    host.answers.insert(
        "https://cdn.acme.example:443/c".into(),
        answer(200, None, b"c"),
    );
    let (egress, host) = egress(host);
    let ok = egress
        .fetch(&key(), &hosts(), &get("https://api.acme.example/a"), 0)
        .await;
    assert_eq!(ok.expect("followed").body.0, b"b");
    assert_eq!(
        host.resolved.lock().len(),
        2,
        "each hop is resolved and pinned again"
    );
    let off = egress
        .fetch(&key(), &hosts(), &get("https://api.acme.example/off"), 0)
        .await;
    assert_eq!(off, Err(Refused::Policy("policy".to_string())));
    assert!(host
        .exchanged
        .lock()
        .iter()
        .all(|r| r.host == "api.acme.example"));
}

#[tokio::test]
async fn each_install_and_member_is_rate_limited() {
    let (egress, _host) = egress(RecordingHost::default());
    let request = get("https://unlisted.example/");
    for _ in 0..MAX_REQUESTS_PER_MINUTE {
        let reply = egress.fetch(&key(), &hosts(), &request, 1_000).await;
        assert_eq!(reply, Err(Refused::Policy("policy".to_string())));
    }
    let limited = egress.fetch(&key(), &hosts(), &request, 1_000).await;
    assert_eq!(limited, Err(Refused::Limit("rate".to_string())));
    let other = ("install-1".to_string(), "bob".to_string());
    assert_ne!(
        egress.fetch(&other, &hosts(), &request, 1_000).await,
        limited
    );
    let later = egress.fetch(&key(), &hosts(), &request, 61_001).await;
    assert_eq!(later, Err(Refused::Policy("policy".to_string())));
}
