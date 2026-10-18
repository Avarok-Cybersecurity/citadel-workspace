//! The Documents relay: its configuration, the rules of a document's log, and the state a
//! kernel keeps for it.
//!
//! Every bound is configuration, and none has a default. A document server's limits depend on
//! where it runs (a Worker has a fraction of a native server's memory) and on what its clients
//! send, so a server that does not say refuses to start (`resolve_documents_config`), and a
//! kernel built without them refuses every documents request (`DocumentRefusal::NotConfigured`)
//! rather than guess.

pub(crate) mod admission;
mod config;
pub(crate) mod coverage;
pub(crate) mod crdt;
pub(crate) mod frame;
pub(crate) mod log;
pub(crate) mod materialise;

pub use config::{DocumentsConfig, JSON_BYTES_PER_PAYLOAD_BYTE};

use crate::kernel::rate_limiter::RateLimiter;
use parking_lot::Mutex;
use std::collections::HashSet;
use std::sync::Arc;
use std::time::Duration;

/// What a kernel holds for the relay: its configuration, and the per-session rate limiters,
/// whose buckets every clone of the kernel shares.
#[derive(Clone)]
pub struct DocumentsRelay {
    pub config: DocumentsConfig,
    pub(crate) awareness_limiter: RateLimiter,
    pub(crate) append_limiter: RateLimiter,
    pub(crate) pull_limiter: RateLimiter,
    /// The documents the server is compacting now, so one is never compacted twice at once.
    pub(crate) compacting: Arc<Mutex<HashSet<String>>>,
}

impl DocumentsRelay {
    /// Refuses a configuration `validate` refuses.
    pub fn new(config: DocumentsConfig) -> Result<Self, String> {
        config.validate()?;
        let per_second = |budget: u32| RateLimiter::new(budget, Duration::from_secs(1));
        Ok(Self {
            config,
            awareness_limiter: per_second(config.awareness_per_second),
            append_limiter: per_second(config.appends_per_second),
            pull_limiter: per_second(config.pulls_per_second),
            compacting: Arc::new(Mutex::new(HashSet::new())),
        })
    }
}

#[cfg(test)]
mod admission_tests;
#[cfg(test)]
mod config_tests;
#[cfg(test)]
mod coverage_tests;
#[cfg(test)]
mod log_tests;
