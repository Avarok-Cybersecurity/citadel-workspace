//! The server's identity (identity doc §3.1/§6 rev b; contract `server-identity-challenge.md`):
//! its canonical domain and former ones (`[identity]`, [`config`]), its ML-DSA-65 key, the
//! answer to `ServerIdentityChallenge`, and the `/.well-known/citadel` document.
//!
//! The key is expanded from a 32-byte seed made once by an explicit command (`--init-server-key`,
//! [`key_file`]) or held by a hosted server's host; the kernel never makes one itself. The
//! document is built here and nowhere else, so the tenant worker and a self-hosted server's
//! reverse proxy publish one artefact.

pub mod config;
pub mod enrolment;
#[cfg(not(target_family = "wasm"))]
pub mod key_file;
pub mod registration;

use crate::platform::Instant;
use citadel_identity::{CanonicalDomain, ServerKey, WellKnownCitadel, WELL_KNOWN_VERSION};
use citadel_workspace_types::server_identity::{ServerIdentity as Answer, ServerIdentityChallenge};
use citadel_workspace_types::WorkspaceProtocolResponse;
use config::{Discovery, IdentityPlan};
use parking_lot::Mutex;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

/// A session may be answered at most once per this interval (contract §2).
pub const CHALLENGE_INTERVAL: Duration = Duration::from_secs(1);
/// Sessions remembered before the stale ones are forgotten.
const GATE_PRUNE_AT: usize = 1024;

pub const NO_SESSION: &str = "the server identity challenge needs an authenticated session";
pub const TOO_SOON: &str = "the server identity challenge was asked again within a second";

/// The kernel's identity: the checked `[identity]` and the key. Shared by every clone.
pub struct ServerIdentity {
    plan: IdentityPlan,
    key: ServerKey,
    last_answered: Mutex<HashMap<u64, Instant>>,
}

/// The identity as the kernel holds it: `None` until the bootstrap installs it, and then every
/// challenge is refused rather than answered under a name nobody configured.
pub type ServerIdentityHandle = Option<Arc<ServerIdentity>>;

impl ServerIdentity {
    pub fn new(plan: IdentityPlan, key: ServerKey) -> Self {
        Self {
            plan,
            key,
            last_answered: Mutex::new(HashMap::new()),
        }
    }

    pub fn plan(&self) -> &IdentityPlan {
        &self.plan
    }

    pub fn key(&self) -> &ServerKey {
        &self.key
    }

    pub fn accepted_domains(&self) -> Vec<CanonicalDomain> {
        self.plan.accepted_domains()
    }

    /// `GetWorkspace.accepted_domains`: canonical first, then the former names.
    pub fn accepted_domain_names(&self) -> Vec<String> {
        self.accepted_domains()
            .into_iter()
            .map(|d| d.as_str().to_string())
            .collect()
    }

    fn admit(&self, cid: u64, now: Instant) -> bool {
        let mut last = self.last_answered.lock();
        if let Some(at) = last.get(&cid) {
            if now.saturating_duration_since(*at) < CHALLENGE_INTERVAL {
                return false;
            }
        }
        if last.len() >= GATE_PRUNE_AT {
            last.retain(|_, at| now.saturating_duration_since(*at) < CHALLENGE_INTERVAL);
        }
        last.insert(cid, now);
        true
    }

    /// The answer to `challenge` from the session `cid` (the kernel's own record of it), at
    /// most once per [`CHALLENGE_INTERVAL`] per session. No other effect.
    pub fn answer(
        &self,
        cid: Option<u64>,
        challenge: &ServerIdentityChallenge,
        now: Instant,
    ) -> WorkspaceProtocolResponse {
        let Some(cid) = cid else {
            return WorkspaceProtocolResponse::Error(NO_SESSION.to_string());
        };
        if !self.admit(cid, now) {
            return WorkspaceProtocolResponse::Error(TOO_SOON.to_string());
        }
        let domain = &self.plan.canonical;
        WorkspaceProtocolResponse::ServerIdentity(Answer {
            domain: domain.as_str().to_string(),
            pk: self.key.public_key().as_bytes().to_vec(),
            sig: self.key.sign_challenge(domain, cid, &challenge.nonce),
        })
    }

    /// The `/.well-known/citadel` JSON, issued at `issued_at_s`. Only a `well_known` server
    /// publishes one; a `pinned` server's clients are handed the key out of band.
    pub fn well_known_document(&self, issued_at_s: u64) -> Result<Vec<u8>, String> {
        let wss =
            match (self.plan.discovery, self.plan.citadel_wss.as_ref()) {
                (Discovery::WellKnown, Some(wss)) => wss.clone(),
                _ => return Err(
                    "this server is discovery = \"pinned\"; it publishes no /.well-known/citadel"
                        .into(),
                ),
            };
        let doc = WellKnownCitadel {
            v: WELL_KNOWN_VERSION,
            canonical_domain: self.plan.canonical.clone(),
            citadel_wss: Some(wss),
            server_key: self.key.public_key().clone(),
            former_domains: self.plan.former.clone(),
            issued_at_s,
        };
        self.key
            .sign_well_known(&doc)
            .map_err(|e| format!("cannot build /.well-known/citadel: {e}"))
    }
}

/// The credential rules a server registers with: the SDK's, with the username cap raised to
/// `citadel_identity::MAX_USERNAME_BYTES` so `handle@domain` fits (the SDK's own default is 37).
pub fn credential_requirements() -> citadel_user::credentials::CredentialRequirements {
    const MAX_USERNAME: u8 = {
        assert!(citadel_identity::MAX_USERNAME_BYTES <= u8::MAX as usize);
        citadel_identity::MAX_USERNAME_BYTES as u8
    };
    citadel_user::credentials::CredentialRequirements {
        max_username_length: MAX_USERNAME,
        ..Default::default()
    }
}

/// A hosted server's identity: `[identity]` as its host wrote it, and the seed its host keeps
/// (a Durable Object, in its own storage). The host serves the document, so the native-only
/// file keys are refused rather than ignored.
pub fn hosted_identity(
    config: Option<&config::IdentityConfig>,
    seed: &[u8; citadel_identity::SEED_LEN],
) -> Result<ServerIdentity, String> {
    let plan = config::plan(config)?;
    if let Some(config) = config {
        for (key, set) in [
            ("server_key_file", config.server_key_file.is_some()),
            ("well_known_file", config.well_known_file.is_some()),
        ] {
            if set {
                return Err(format!(
                    "[identity] {key} is a native server's; a hosted server's host keeps its key \
                     and serves its document"
                ));
            }
        }
    }
    Ok(ServerIdentity::new(plan, ServerKey::from_seed(seed)))
}
