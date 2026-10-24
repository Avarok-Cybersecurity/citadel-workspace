//! Host egress for Citadel apps (`AppFetch`): what the agent must never let an app reach.
//!
//! The page origins come from the origin allowlist the agent already requires, so the two
//! cannot disagree. An allowlist of `*` names no origin, and then host egress stays off: an
//! agent that does not know which page is its own cannot refuse it as a target.
//!
//! Whether apps may reach a member's private network is not configured here: it is each
//! member's own grant on this agent (citadel-internal-service's kernel/apps/settings.rs).

use citadel_internal_service::{AppNetConfig, OriginPolicy};

/// The host of an allowed origin (`https://acme.work.avarok.net:8443` -> `acme.work.avarok.net`).
fn origin_host(origin: &str) -> Option<String> {
    let rest = origin
        .strip_prefix("https://")
        .or_else(|| origin.strip_prefix("http://"))?;
    let host = match rest.strip_prefix('[') {
        Some(bracketed) => bracketed.split(']').next()?,
        None => rest.split(':').next()?,
    };
    (!host.is_empty()).then(|| host.to_ascii_lowercase())
}

pub fn app_net_config(origins: &OriginPolicy, agent_port: u16) -> AppNetConfig {
    let page_origin_hosts = match origins {
        OriginPolicy::Allow(list) => list.iter().filter_map(|o| origin_host(o)).collect(),
        OriginPolicy::Any => Vec::new(),
    };
    AppNetConfig {
        page_origin_hosts,
        agent_port,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_allowed_origin_host_is_refused_as_a_target() {
        let origins = OriginPolicy::parse(
            "https://acme.work.avarok.net,http://localhost:5291,https://LOCAL.avarok.net:8443",
        )
        .unwrap();
        let config = app_net_config(&origins, 12345);
        assert_eq!(
            config.page_origin_hosts,
            vec!["acme.work.avarok.net", "localhost", "local.avarok.net"]
        );
        assert_eq!(config.agent_port, 12345);
    }

    #[test]
    fn any_origin_leaves_host_egress_unconfigured() {
        let config = app_net_config(&OriginPolicy::Any, 12345);
        assert!(config.page_origin_hosts.is_empty());
    }
}
