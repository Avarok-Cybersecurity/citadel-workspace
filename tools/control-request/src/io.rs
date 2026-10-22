//! The I/O the tools share: OS randomness for nonces, the wall clock, and HTTPS.

use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// How long one request may take, connect to last byte.
const HTTP_TIMEOUT: Duration = Duration::from_secs(60);

/// `N` bytes from the OS.
pub fn nonce<const N: usize>() -> Result<[u8; N], String> {
    let mut nonce = [0u8; N];
    getrandom::fill(&mut nonce).map_err(|e| format!("no OS randomness: {e}"))?;
    Ok(nonce)
}

/// Now, in Unix milliseconds.
pub fn now_ms() -> Result<u64, String> {
    Ok(SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| format!("the clock is before 1970: {e}"))?
        .as_millis() as u64)
}

/// POSTs `body` (JSON) to `url` and returns the answer's text when it is a success; otherwise
/// the error says what the server answered.
pub fn post_json(url: &str, body: String) -> Result<String, String> {
    let mut response = agent()
        .post(url)
        .header("content-type", "application/json")
        .send(body)
        .map_err(|e| format!("{url}: {e}"))?;
    let status = response.status();
    let text = response
        .body_mut()
        .read_to_string()
        .map_err(|e| format!("{url}: reading the answer: {e}"))?;
    if status.is_success() {
        Ok(text)
    } else {
        Err(format!("{url} answered {status}: {text}"))
    }
}

/// HTTPS whose only key exchange is the hybrid post-quantum X25519MLKEM768 (TLS 1.3): a server
/// that cannot do it is refused rather than reached over a classical-only exchange.
fn agent() -> ureq::Agent {
    let base = rustls::crypto::aws_lc_rs::default_provider();
    let provider = rustls::crypto::CryptoProvider {
        kx_groups: vec![rustls::crypto::aws_lc_rs::kx_group::X25519MLKEM768],
        ..base
    };
    let tls = ureq::tls::TlsConfig::builder()
        .provider(ureq::tls::TlsProvider::Rustls)
        .unversioned_rustls_crypto_provider(Arc::new(provider))
        .build();
    ureq::Agent::config_builder()
        .tls_config(tls)
        .https_only(true)
        .http_status_as_error(false)
        .timeout_global(Some(HTTP_TIMEOUT))
        .build()
        .into()
}
