//! What the server's Citadel node is told about the network it runs on.
//!
//! STUN servers are required configuration with no built-in list: the SDK refuses to build a
//! node without at least three distinct `host:port` endpoints, because a default would report
//! every node's public address to third parties nobody chose. A native server names them in
//! `kernel.toml` (`stun_servers`); a hosted server's host supplies them, and a hosted config
//! that names them is refused, so there is one source for each deployment.

use citadel_sdk::prelude::{NetworkError, StunServers};

/// The network settings a hosted server's host supplies (`run_server_on`).
#[derive(Clone, Debug)]
pub struct HostedNetwork {
    pub stun_servers: StunServers,
}

/// A native server's STUN servers: `kernel.toml`'s `stun_servers`, which it will not start
/// without.
pub fn native_stun_servers(configured: Option<&[String]>) -> Result<StunServers, NetworkError> {
    let servers = configured.ok_or_else(|| {
        NetworkError::msg(
            "stun_servers must be set in kernel.toml: at least three distinct host:port STUN \
             servers the node learns its NAT mapping from (there is no default list)",
        )
    })?;
    StunServers::new(servers.iter().cloned())
        .map_err(|e| NetworkError::msg(format!("kernel.toml stun_servers: {e}")))
}

/// A hosted server takes its STUN servers from its host only.
pub fn refuse_configured_stun_servers(configured: Option<&[String]>) -> Result<(), NetworkError> {
    match configured {
        None => Ok(()),
        Some(_) => Err(NetworkError::msg(
            "stun_servers is a native server's; a hosted server's host supplies its STUN servers",
        )),
    }
}

/// `servers` as the SDK's `NodeBuilder::with_stun_servers` takes them.
pub fn builder_list(servers: &StunServers) -> Vec<String> {
    servers.as_slice().to_vec()
}
