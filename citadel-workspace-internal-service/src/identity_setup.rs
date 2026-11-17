//! The agent's portable identity (citadel-internal-service's kernel/identity), configured. A
//! service never given it refuses every identity request as `NotConfigured`.
//!
//! Its three timings are required, as `--bind` and the STUN servers are: none has a value that
//! is right for every deployment, so the agent refuses to start without them rather than
//! choosing. The store is not a setting: it follows the account backend, because the identity
//! derives every identity account's password and must persist exactly when they do.

use crate::server_identity_codec::WorkspaceServerIdentityCodec;
use citadel_internal_service::kernel::identity::{
    FsIdentityStore, HttpsWellKnownFetch, IdentityConfig, IdentityStore, MemoryIdentityStore,
};
use citadel_internal_service::kernel::CitadelWorkspaceService;
use citadel_internal_service_connector::io_interface::IOInterface;
use citadel_sdk::prelude::{BackendType, Ratchet};
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

/// One required timing: its flag, the variable that overrides it, and what it bounds.
pub struct Timing {
    pub flag: &'static str,
    pub env: &'static str,
    what: &'static str,
}

pub const UNLOCK_IDLE: Timing = Timing {
    flag: "--identity-unlock-idle-secs",
    env: "INTERNAL_SERVICE_IDENTITY_UNLOCK_IDLE_SECS",
    what: "how long the unsealed identity is kept after its last use",
};
pub const CHALLENGE_TIMEOUT: Timing = Timing {
    flag: "--identity-challenge-timeout-secs",
    env: "INTERNAL_SERVICE_IDENTITY_CHALLENGE_TIMEOUT_SECS",
    what: "how long a sign-in waits for the server to prove its key",
};
pub const FETCH_TIMEOUT: Timing = Timing {
    flag: "--identity-fetch-timeout-secs",
    env: "INTERNAL_SERVICE_IDENTITY_FETCH_TIMEOUT_SECS",
    what: "how long fetching a server's /.well-known/citadel may take",
};

/// Where the identity record is kept, under a filesystem backend's data directory.
const STORE_DIR: &str = "identity";

/// The resolved timings.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct IdentityTimings {
    pub unlock_idle: Duration,
    pub challenge_timeout: Duration,
    pub fetch_timeout: Duration,
}

/// Whole seconds, at least one: the variable over the flag, an empty string as unset (an unset
/// `.env` entry arrives as `Some("")`, as for the other settings).
fn seconds(timing: &Timing, env: Option<&str>, cli: Option<&str>) -> Result<Duration, String> {
    let Timing {
        flag,
        env: var,
        what,
    } = timing;
    let spec = env
        .filter(|s| !s.is_empty())
        .or(cli.filter(|s| !s.is_empty()))
        .ok_or_else(|| {
            format!("no {flag} configured ({what}). Pass {flag} <seconds>, or set {var}.")
        })?;
    match spec.trim().parse::<u64>() {
        Ok(secs) if secs > 0 => Ok(Duration::from_secs(secs)),
        _ => Err(format!(
            "invalid {flag} / {var}: {spec:?} is not a whole number of seconds above zero"
        )),
    }
}

impl IdentityTimings {
    /// Each argument is a timing's `(env, cli)` pair. Pure: no I/O.
    pub fn resolve(
        unlock_idle: (Option<&str>, Option<&str>),
        challenge_timeout: (Option<&str>, Option<&str>),
        fetch_timeout: (Option<&str>, Option<&str>),
    ) -> Result<Self, String> {
        Ok(Self {
            unlock_idle: seconds(&UNLOCK_IDLE, unlock_idle.0, unlock_idle.1)?,
            challenge_timeout: seconds(
                &CHALLENGE_TIMEOUT,
                challenge_timeout.0,
                challenge_timeout.1,
            )?,
            fetch_timeout: seconds(&FETCH_TIMEOUT, fetch_timeout.0, fetch_timeout.1)?,
        })
    }
}

/// `<data dir>/identity` for a filesystem backend, memory for an in-memory one.
fn store_for(backend: &BackendType) -> Result<Arc<dyn IdentityStore>, String> {
    match backend {
        BackendType::Filesystem(dir) => Ok(Arc::new(FsIdentityStore::new(
            Path::new(dir).join(STORE_DIR),
        ))),
        BackendType::InMemory => Ok(Arc::new(MemoryIdentityStore::default())),
        #[allow(unreachable_patterns)]
        other => Err(format!("no identity store for the backend {other:?}")),
    }
}

/// Everything `with_identity` takes. Builds an HTTPS client; opens and fetches nothing.
pub fn identity_config(
    timings: &IdentityTimings,
    backend: &BackendType,
) -> Result<IdentityConfig, String> {
    let well_known = HttpsWellKnownFetch::new(timings.fetch_timeout)
        .map_err(|err| format!("cannot build the /.well-known/citadel client: {err}"))?;
    Ok(IdentityConfig {
        store: store_for(backend)?,
        well_known: Arc::new(well_known),
        codec: Arc::new(WorkspaceServerIdentityCodec),
        unlock_idle: timings.unlock_idle,
        challenge_timeout: timings.challenge_timeout,
    })
}

/// `service` holding the identity `config` describes.
pub fn applied<T: IOInterface, R: Ratchet>(
    service: CitadelWorkspaceService<T, R>,
    config: IdentityConfig,
) -> CitadelWorkspaceService<T, R> {
    service.with_identity(config)
}

#[cfg(test)]
#[path = "identity_setup_tests.rs"]
mod tests;
