//! kernel.toml's `[identity]`: the server's name and how clients come to trust its key
//! (identity doc §3.1/§6 rev b, master plan §9 D-A). Required by every server, native and hosted;
//! no key has a default, so a server that does not say refuses to start.
//!
//! ```toml
//! [identity]
//! canonical_domain = "work.example.com"        # what clients dial, canonical (no scheme, no :443)
//! former_domains = []                          # names this server answered to before; may be empty
//! discovery = "well_known"                     # or "pinned": no HTTPS, key confirmed out of band
//! citadel_wss = "wss://work.example.com/citadel"   # well_known only: the dial address it publishes
//! server_key_file = "/data/server/identity/server-key"    # native only, made by --init-server-key
//! well_known_file = "/data/server/identity/well-known.json"   # native well_known only
//! registration_names = "allow_legacy"          # or "require_canonical": identity doc §6 rule 1
//! ```
//!
//! The canonical domain is never taken from `bind_addr` or any other key: the address a socket
//! binds is not the name people reach it by.

use citadel_identity::{canonical_domain, CanonicalDomain};
use serde::Deserialize;

/// The most former domains `/.well-known/citadel` may list (its schema's `maxItems`).
pub const MAX_FORMER_DOMAINS: usize = 16;

/// How clients learn this server's key.
#[derive(Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Discovery {
    /// The operator serves the kernel's `/.well-known/citadel` over HTTPS.
    WellKnown,
    /// No HTTPS: the operator hands out the key's fingerprint, and clients show the domain as
    /// unverified until the post-connect challenge matches the key they were given.
    Pinned,
}

/// Which new names rule 1 (identity doc §6) admits. Required, with no default: the rollout
/// turns `RequireCanonical` on together with the UI's identity sign-up (lane I5), and until then
/// every shipped server says `AllowLegacy`.
#[derive(Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RegistrationNames {
    /// Every registration is `handle@<canonical_domain>`; a bare name is refused.
    RequireCanonical,
    /// A bare name registers too. Rules 2 and 3 still hold for `handle@<canonical_domain>`, rule 3
    /// both ways, and a name under any other domain is still refused.
    AllowLegacy,
}

/// `[identity]` as written.
#[derive(Deserialize, Debug, Clone)]
#[serde(deny_unknown_fields)]
pub struct IdentityConfig {
    pub canonical_domain: Option<String>,
    pub former_domains: Option<Vec<String>>,
    pub discovery: Option<Discovery>,
    pub citadel_wss: Option<String>,
    pub server_key_file: Option<String>,
    pub well_known_file: Option<String>,
    pub registration_names: Option<RegistrationNames>,
}

/// `[identity]`, checked: the names and the discovery mode. Nothing read yet.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IdentityPlan {
    pub canonical: CanonicalDomain,
    pub former: Vec<CanonicalDomain>,
    pub discovery: Discovery,
    /// `Some` exactly when `discovery` is `WellKnown`.
    pub citadel_wss: Option<String>,
    pub registration_names: RegistrationNames,
}

impl IdentityPlan {
    /// Every name this server answers to, canonical first: the SSOT for sign-in, bindings,
    /// enrolment and `GetWorkspace.accepted_domains`.
    pub fn accepted_domains(&self) -> Vec<CanonicalDomain> {
        std::iter::once(self.canonical.clone())
            .chain(self.former.iter().cloned())
            .collect()
    }
}

fn exactly_canonical(key: &str, text: &str) -> Result<CanonicalDomain, String> {
    let domain = canonical_domain(text)
        .map_err(|why| format!("[identity] {key} {text:?} is not a server name: {why}"))?;
    if domain.as_str() != text {
        return Err(format!(
            "[identity] {key} {text:?} is not canonical; write {:?}",
            domain.as_str()
        ));
    }
    Ok(domain)
}

fn former(
    config: &IdentityConfig,
    canonical: &CanonicalDomain,
) -> Result<Vec<CanonicalDomain>, String> {
    let texts = config.former_domains.as_ref().ok_or(
        "[identity] former_domains is required: the names this server answered to before, or [] \
         for none",
    )?;
    if texts.len() > MAX_FORMER_DOMAINS {
        return Err(format!(
            "[identity] former_domains lists {}; at most {MAX_FORMER_DOMAINS} are published",
            texts.len()
        ));
    }
    let mut domains: Vec<CanonicalDomain> = Vec::with_capacity(texts.len());
    for text in texts {
        let domain = exactly_canonical("former_domains entry", text)?;
        if domain == *canonical || domains.contains(&domain) {
            return Err(format!(
                "[identity] former_domains repeats {text:?} (or names the canonical domain)"
            ));
        }
        domains.push(domain);
    }
    Ok(domains)
}

fn endpoint(config: &IdentityConfig, discovery: Discovery) -> Result<Option<String>, String> {
    match (discovery, config.citadel_wss.as_ref()) {
        (Discovery::Pinned, None) => Ok(None),
        (Discovery::Pinned, Some(_)) => Err(
            "[identity] citadel_wss is set but discovery = \"pinned\": nothing publishes it".into(),
        ),
        (Discovery::WellKnown, None) => Err(
            "[identity] citadel_wss is required with discovery = \"well_known\": the wss:// \
             address /.well-known/citadel tells clients to dial"
                .into(),
        ),
        (Discovery::WellKnown, Some(wss)) => {
            let host = wss
                .strip_prefix("wss://")
                .ok_or_else(|| format!("[identity] citadel_wss {wss:?} is not a wss:// URL"))?;
            canonical_domain(host)
                .map_err(|why| format!("[identity] citadel_wss {wss:?}: {why}"))?;
            Ok(Some(wss.clone()))
        }
    }
}

/// The plan `config` describes, or the first thing wrong with it. `None` is a kernel.toml with
/// no `[identity]` at all.
pub fn plan(config: Option<&IdentityConfig>) -> Result<IdentityPlan, String> {
    let config = config.ok_or(
        "kernel.toml has no [identity] section; a server must name itself (canonical_domain, \
         former_domains and discovery -- see docker/workspace-server/kernel.toml)",
    )?;
    let text = config
        .canonical_domain
        .as_deref()
        .ok_or("[identity] canonical_domain is required: the name clients reach this server by")?;
    let canonical = exactly_canonical("canonical_domain", text)?;
    let former = former(config, &canonical)?;
    let discovery = config
        .discovery
        .ok_or("[identity] discovery is required: \"well_known\" or \"pinned\"")?;
    let citadel_wss = endpoint(config, discovery)?;
    let registration_names = config.registration_names.ok_or(
        "[identity] registration_names is required: \"require_canonical\" (every new name is \
         handle@<canonical_domain>) or \"allow_legacy\" (bare names register too)",
    )?;
    Ok(IdentityPlan {
        canonical,
        former,
        discovery,
        citadel_wss,
        registration_names,
    })
}
