//! The production fetcher itself, against a raw listener on `127.0.0.1:0`.
//!
//! The policy refuses loopback, as it must, so nothing here goes through it: the fetcher is
//! the layer below, handed an exchange already decided and pinned. Its https-only client
//! cannot complete a handshake with a test listener whose certificate no root signs, so
//! these assert what reaches the listener: a TLS ClientHello naming the pinned host proves
//! the connection went to the pinned address without resolving `pinned.invalid` (which
//! never resolves, RFC 6761) and without a proxy; a plain-HTTP URL reaching nothing proves
//! https-only.

use super::egress_native::{shown_headers, NativeEgressFetcher};
use super::egress_port::{EgressFetcher, PinnedRequest};
use reqwest::header::{HeaderMap, HeaderValue};
use std::net::SocketAddr;
use std::time::Duration;
use tokio::io::AsyncReadExt;
use tokio::net::TcpListener;
use tokio::sync::oneshot;

const PINNED_HOST: &str = "pinned.invalid";
/// Set only in the child process `an_environment_proxy_is_never_used` starts.
const PROXY_PROBE: &str = "CITADEL_KERNEL_PROXY_PROBE";
/// How long a test waits for a connection that, on the passing path, has already arrived.
const ARRIVAL_MS: u64 = 1_000;

/// The first bytes of the one connection the listener accepts, if one arrives.
async fn listen() -> (SocketAddr, oneshot::Receiver<Vec<u8>>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
    let address = listener.local_addr().expect("address");
    let (tx, rx) = oneshot::channel();
    drop(tokio::spawn(async move {
        if let Ok((mut socket, _)) = listener.accept().await {
            let mut buf = vec![0u8; 4096];
            let n = socket.read(&mut buf).await.unwrap_or(0);
            buf.truncate(n);
            let _ = tx.send(buf);
        }
    }));
    (address, rx)
}

fn pinned(scheme: &str, address: SocketAddr) -> PinnedRequest {
    PinnedRequest {
        method: "GET".into(),
        url: format!("{scheme}://{PINNED_HOST}:{}/", address.port()),
        host: PINNED_HOST.into(),
        connect: vec![address],
        headers: vec![],
        body: vec![],
    }
}

async fn arrived(rx: oneshot::Receiver<Vec<u8>>) -> Option<Vec<u8>> {
    tokio::time::timeout(Duration::from_millis(ARRIVAL_MS), rx)
        .await
        .ok()?
        .ok()
}

/// A TLS handshake record whose ClientHello carries the pinned name as its server name.
fn is_client_hello_for_pinned_host(bytes: &[u8]) -> bool {
    bytes.first() == Some(&0x16)
        && bytes
            .windows(PINNED_HOST.len())
            .any(|w| w == PINNED_HOST.as_bytes())
}

async fn reaches_the_pinned_address() -> bool {
    let (address, rx) = listen().await;
    let answer = NativeEgressFetcher
        .exchange(pinned("https", address), 1024, 5_000)
        .await;
    assert!(
        answer.is_err(),
        "an untrusted listener answered: {answer:?}"
    );
    arrived(rx)
        .await
        .is_some_and(|bytes| is_client_hello_for_pinned_host(&bytes))
}

#[tokio::test]
async fn the_fetcher_connects_to_the_pinned_address_under_the_pinned_name() {
    assert!(
        reaches_the_pinned_address().await,
        "no ClientHello for the pinned name arrived"
    );
}

#[tokio::test]
async fn a_plain_http_exchange_never_connects() {
    let (address, rx) = listen().await;
    let answer = NativeEgressFetcher
        .exchange(pinned("http", address), 1024, 5_000)
        .await;
    assert!(answer.is_err(), "{answer:?}");
    assert_eq!(
        arrived(rx).await,
        None,
        "an http request reached the listener"
    );
}

#[tokio::test]
#[ignore = "run by an_environment_proxy_is_never_used, in a process of its own"]
async fn proxy_probe_child() {
    if std::env::var_os(PROXY_PROBE).is_none() {
        return;
    }
    assert!(
        reaches_the_pinned_address().await,
        "the exchange went to the proxy"
    );
}

/// reqwest reads the system proxy once per process, so the proxy is set in a child's.
#[test]
fn an_environment_proxy_is_never_used() {
    let module = module_path!().split_once("::").map_or("", |(_, rest)| rest);
    let child = format!("{module}::proxy_probe_child");
    let exe = std::env::current_exe().expect("the test binary");
    let mut command = std::process::Command::new(exe);
    command
        .args([child.as_str(), "--exact", "--ignored", "--test-threads=1"])
        .env(PROXY_PROBE, "1");
    for name in [
        "HTTP_PROXY",
        "http_proxy",
        "HTTPS_PROXY",
        "https_proxy",
        "ALL_PROXY",
        "all_proxy",
    ] {
        command.env(name, "http://127.0.0.1:1");
    }
    for name in ["NO_PROXY", "no_proxy"] {
        command.env_remove(name);
    }
    let output = command.output().expect("the child ran");
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(
        output.status.success() && stdout.contains("1 passed"),
        "the fetcher went through the environment's proxy:\n{stdout}\n{}",
        String::from_utf8_lossy(&output.stderr)
    );
}

#[test]
fn an_upstream_cookie_or_challenge_is_never_shown() {
    let mut headers = HeaderMap::new();
    headers.insert("set-cookie", HeaderValue::from_static("session=stolen"));
    headers.insert(
        "www-authenticate",
        HeaderValue::from_static("Basic realm=x"),
    );
    headers.insert("transfer-encoding", HeaderValue::from_static("chunked"));
    headers.insert("content-type", HeaderValue::from_static("application/json"));
    // The control is the kept `content-type`: the scrub is not a blanket drop.
    assert_eq!(
        shown_headers(&headers),
        vec![("content-type".to_string(), "application/json".to_string())]
    );
}
