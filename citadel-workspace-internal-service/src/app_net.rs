//! Host egress for Citadel apps (`AppFetch`): what the agent must never let an app reach.
//!
//! The page origins come from the origin allowlist the agent already requires, so the two
//! cannot disagree. An allowlist of `*` names no origin, and then host egress stays off: an
//! agent that does not know which page is its own cannot refuse it as a target.
//!
//! Whether apps may reach the member's private network (`apps.private_network`) is the
//! member's own setting, required like the origins: a page's grant asks, this decides.

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

/// `apps.private_network` on the command line.
pub const PRIVATE_NETWORK_FLAG: &str = "--apps-private-network";
/// `apps.private_network` in the environment, which takes precedence.
pub const PRIVATE_NETWORK_ENV: &str = "INTERNAL_SERVICE_APPS_PRIVATE_NETWORK";

/// `apps.private_network`: env over CLI, empty as unset, and exactly `true` or `false`.
/// Required, with no default: an agent that has not been told cannot guess which answer its
/// member wants, and either guess is wrong for someone.
pub fn resolve_private_network(env: Option<&str>, cli: Option<&str>) -> Result<bool, String> {
    let spec = env
        .filter(|s| !s.is_empty())
        .or(cli.filter(|s| !s.is_empty()));
    match spec {
        Some("true") => Ok(true),
        Some("false") => Ok(false),
        Some(other) => Err(format!(
            "invalid {PRIVATE_NETWORK_FLAG} {other:?}: it is `true` or `false`"
        )),
        None => Err(format!(
            "apps.private_network is not configured. Pass {PRIVATE_NETWORK_FLAG} false (or set \
             {PRIVATE_NETWORK_ENV}=false); `true` lets apps the member approved for \
             net.host.private reach their LAN through this agent."
        )),
    }
}

pub fn app_net_config(
    origins: &OriginPolicy,
    agent_port: u16,
    private_network: bool,
) -> AppNetConfig {
    let page_origin_hosts = match origins {
        OriginPolicy::Allow(list) => list.iter().filter_map(|o| origin_host(o)).collect(),
        OriginPolicy::Any => Vec::new(),
    };
    AppNetConfig {
        page_origin_hosts,
        agent_port,
        private_network,
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
        let config = app_net_config(&origins, 12345, false);
        assert_eq!(
            config.page_origin_hosts,
            vec!["acme.work.avarok.net", "localhost", "local.avarok.net"]
        );
        assert_eq!(config.agent_port, 12345);
        assert!(!config.private_network);
    }

    #[test]
    fn any_origin_leaves_host_egress_unconfigured() {
        let config = app_net_config(&OriginPolicy::Any, 12345, true);
        assert!(config.page_origin_hosts.is_empty());
    }

    #[test]
    fn the_private_network_setting_is_required_and_exact() {
        assert!(resolve_private_network(None, None).is_err());
        assert!(resolve_private_network(Some(""), Some("")).is_err());
        assert!(resolve_private_network(None, Some("yes")).is_err());
        assert!(resolve_private_network(None, Some("TRUE")).is_err());
        assert_eq!(resolve_private_network(None, Some("false")), Ok(false));
        assert_eq!(resolve_private_network(None, Some("true")), Ok(true));
        // The environment wins, and an empty one is unset.
        assert_eq!(
            resolve_private_network(Some("true"), Some("false")),
            Ok(true)
        );
        assert_eq!(resolve_private_network(Some(""), Some("false")), Ok(false));
    }
}
