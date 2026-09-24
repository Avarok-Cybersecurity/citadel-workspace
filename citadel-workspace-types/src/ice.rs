//! Relay (TURN) servers a member's agent may use for peer connections.
//!
//! An agent is never configured with TURN credentials: it asks its workspace server with
//! `GetIceServers` and receives short-lived ones over its encrypted Citadel session. The server
//! mints them through whatever its host provides (a Durable Object calls Cloudflare's TURN API);
//! the long-lived API key that mints them never leaves that host.

use custom_debug::Debug;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// One entry of an `RTCConfiguration.iceServers` list, in the shape WebRTC takes it.
///
/// `credential` is a TURN password: it is redacted from `Debug`, since the kernel logs
/// responses at debug level.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct IceServer {
    pub urls: Vec<String>,
    pub username: Option<String>,
    #[debug(with = secret_opt_debug_fmt)]
    pub credential: Option<String>,
}

fn secret_opt_debug_fmt(value: &Option<String>, f: &mut std::fmt::Formatter) -> std::fmt::Result {
    match value {
        Some(_) => write!(f, "Some(<redacted>)"),
        None => write!(f, "None"),
    }
}

#[cfg(test)]
mod tests {
    use super::IceServer;

    #[test]
    fn a_credential_is_never_printed() {
        let server = IceServer {
            urls: vec!["turns:turn.example:443?transport=tcp".to_string()],
            username: Some("user".to_string()),
            credential: Some("hunter2-turn-password".to_string()),
        };
        let printed = format!("{server:?}");
        assert!(!printed.contains("hunter2"), "{printed}");
        assert!(printed.contains("<redacted>"), "{printed}");
    }
}
