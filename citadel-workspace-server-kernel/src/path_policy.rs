//! The server's path policy as configuration: which network paths peer connections may take, in
//! which order, for how long each attempt runs, and which classes of traffic each may carry.
//!
//! Required, with no default: a native server reads it from kernel.toml's `[path_policy]`, a
//! hosted server's host supplies it from the tenant's plan (deploy/tenant-worker
//! control/path-policy.mjs), in this same shape. The protocol's `PathPolicy::new` validates it.

use citadel_sdk::prelude::{NetworkError, PathClass, PathClasses, PathKind, PathPolicy, PathRule};
use serde::Deserialize;
use std::time::Duration;

/// `[path_policy]`: `rules` in precedence order, one per path kind, and the classes no path
/// may carry.
#[derive(Deserialize, Debug, Clone, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct PathPolicyConfig {
    pub rules: Vec<PathRuleConfig>,
    pub denied: Vec<PathClass>,
}

/// One `[[path_policy.rules]]` entry.
#[derive(Deserialize, Debug, Clone, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct PathRuleConfig {
    pub kind: PathKind,
    pub enabled: bool,
    pub attempt_timeout_seconds: u64,
    pub cost_weight: u32,
    pub classes: Vec<PathClass>,
}

impl PathPolicyConfig {
    /// The validated policy, or why the protocol refuses it.
    pub fn policy(&self) -> Result<PathPolicy, NetworkError> {
        let rules = self
            .rules
            .iter()
            .map(|r| PathRule {
                kind: r.kind,
                enabled: r.enabled,
                attempt_timeout: Duration::from_secs(r.attempt_timeout_seconds),
                cost_weight: r.cost_weight,
                classes: PathClasses::of(&r.classes),
            })
            .collect();
        PathPolicy::new(rules, PathClasses::of(&self.denied))
            .map_err(|e| NetworkError::msg(format!("path_policy: {e}")))
    }
}

/// A native server's policy: kernel.toml's `[path_policy]`, which it will not start without.
pub fn native_path_policy(
    configured: Option<&PathPolicyConfig>,
) -> Result<PathPolicy, NetworkError> {
    configured
        .ok_or_else(|| {
            NetworkError::msg(
                "[path_policy] must be set in kernel.toml: the paths peer connections may take, \
                 in order, with each one's attempt timeout and traffic classes (there is no default)",
            )
        })?
        .policy()
}

/// A hosted server takes its path policy from its host only.
pub fn refuse_configured_path_policy(
    configured: Option<&PathPolicyConfig>,
) -> Result<(), NetworkError> {
    match configured {
        None => Ok(()),
        Some(_) => Err(NetworkError::msg(
            "[path_policy] is a native server's; a hosted server's host supplies its path policy",
        )),
    }
}
