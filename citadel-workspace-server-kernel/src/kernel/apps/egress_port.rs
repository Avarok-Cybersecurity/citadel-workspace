//! What server egress (`egress`) asks of the host: a resolver and one pinned exchange. The
//! native server's is `egress_native`; a host without one passes none.

use std::net::{IpAddr, SocketAddr};

/// One exchange the policy allowed, pinned to the addresses it checked.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PinnedRequest {
    pub method: String,
    /// Rebuilt from the checked target: `https://host:port/path?query`.
    pub url: String,
    /// The TLS server name and `Host`.
    pub host: String,
    /// Connect to these and nowhere else; never resolve `host` again.
    pub connect: Vec<SocketAddr>,
    /// Exactly the app's headers, which the policy allowed. Nothing is added.
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EgressAnswer {
    pub status: u16,
    /// Lowercase names.
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EgressFailure {
    Network(String),
    TooLarge,
    Timeout,
}

/// The host capability server egress reaches the world through.
#[async_trait::async_trait]
pub trait EgressFetcher: Send + Sync {
    /// Every address `host` resolves to. Asked only for a host the policy admitted.
    async fn resolve(&self, host: &str, port: u16) -> Result<Vec<IpAddr>, String>;
    /// One exchange with `request.connect`: no redirect followed, no proxy, no cookie or
    /// credential added; a body past `max_body` is `TooLarge`, and the exchange is abandoned
    /// after `timeout_ms` (`Timeout`).
    async fn exchange(
        &self,
        request: PinnedRequest,
        max_body: u64,
        timeout_ms: u64,
    ) -> Result<EgressAnswer, EgressFailure>;
}
