//! The agent's portable identity (citadel-internal-service's kernel/identity), configured. A
//! service never given it refuses every identity request as `NotConfigured`.
//!
//! How long the unsealed identity stays unlocked is required, as `--bind` and the STUN servers
//! are: no value is right for every deployment, so the agent refuses to start without it rather
//! than choosing. The challenge and `/.well-known/citadel` timeouts and the signing rate are
//! protocol constants (`citadel_identity`), not settings. The store is not a setting either: it
//! follows the account backend, because the identity derives every identity account's password
//! and must persist exactly when they do.

use crate::server_identity_codec::WorkspaceServerIdentityCodec;
use citadel_internal_service::kernel::identity::{
    FsIdentityStore, HttpsWellKnownFetch, IdentityConfig, IdentityStore, MemoryIdentityStore,
    MonotonicClock, SignLimits,
};
use citadel_internal_service::kernel::CitadelWorkspaceService;
use citadel_internal_service_connector::io_interface::IOInterface;
use citadel_sdk::prelude::{BackendType, Ratchet};
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

pub const UNLOCK_IDLE_FLAG: &str = "--identity-unlock-idle-secs";
pub const UNLOCK_IDLE_ENV: &str = "INTERNAL_SERVICE_IDENTITY_UNLOCK_IDLE_SECS";

/// Where the identity record is kept, under a filesystem backend's data directory.
const STORE_DIR: &str = "identity";

/// How long the unsealed identity is kept after its last use: whole seconds, at least one; the
/// variable over the flag, an empty string as unset (an unset `.env` entry arrives as
/// `Some("")`, as for the other settings). Pure: no I/O.
pub fn unlock_idle(env: Option<&str>, cli: Option<&str>) -> Result<Duration, String> {
    let spec = env
        .filter(|s| !s.is_empty())
        .or(cli.filter(|s| !s.is_empty()))
        .ok_or_else(|| {
            format!(
                "no {UNLOCK_IDLE_FLAG} configured (how long the unsealed identity is kept after \
                 its last use). Pass {UNLOCK_IDLE_FLAG} <seconds>, or set {UNLOCK_IDLE_ENV}."
            )
        })?;
    match spec.trim().parse::<u64>() {
        Ok(secs) if secs > 0 => Ok(Duration::from_secs(secs)),
        _ => Err(format!(
            "invalid {UNLOCK_IDLE_FLAG} / {UNLOCK_IDLE_ENV}: {spec:?} is not a whole number of \
             seconds above zero"
        )),
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
    unlock_idle: Duration,
    backend: &BackendType,
) -> Result<IdentityConfig, String> {
    let well_known = HttpsWellKnownFetch::new()
        .map_err(|err| format!("cannot build the /.well-known/citadel client: {err}"))?;
    Ok(IdentityConfig {
        store: store_for(backend)?,
        well_known: Arc::new(well_known),
        codec: Arc::new(WorkspaceServerIdentityCodec),
        unlock_idle,
        sign_limits: SignLimits::PROTOCOL,
        // The sign rate is measured on the runtime's monotonic clock: wall time can jump, and
        // the time Argon2id takes on this machine is not the time that has passed.
        clock: Arc::new(MonotonicClock),
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
