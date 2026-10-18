//! The Documents relay: its configuration, and the state a kernel keeps for it.
//!
//! Every bound is configuration, and none has a default. A document server's limits depend on
//! where it runs (a Worker has a fraction of a native server's memory) and on what its clients
//! send, so a server that does not say refuses to start (`resolve_documents_config`), and a
//! kernel built without them refuses every documents request (`DocumentRefusal::NotConfigured`)
//! rather than guess.

pub(crate) mod log;

use crate::kernel::rate_limiter::RateLimiter;
use serde::Deserialize;
use std::time::Duration;

/// The `[documents]` section of `kernel.toml`. Every field is required.
#[derive(Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct DocumentsConfig {
    /// The most updates one `Pull` returns; the reader pulls again for the rest.
    pub max_updates_per_pull: u32,
    /// How many updates since the last snapshot make `Appended` ask for a new one.
    pub snapshot_min_updates: u64,
    /// The largest update an `Append` may carry, in bytes.
    pub max_update_bytes: u64,
    /// The largest snapshot a `StoreSnapshot` may carry, in bytes.
    pub max_snapshot_bytes: u64,
    /// The largest awareness payload the relay forwards, in bytes.
    pub max_awareness_bytes: u64,
    /// How many awareness payloads one session may send per second.
    pub awareness_per_second: u32,
}

impl DocumentsConfig {
    /// A zero in any field would refuse every request of its kind, or ask for a snapshot after
    /// every update; either is a configuration mistake, said at startup.
    pub fn validate(&self) -> Result<(), String> {
        let zero = [
            ("max_updates_per_pull", u64::from(self.max_updates_per_pull)),
            ("snapshot_min_updates", self.snapshot_min_updates),
            ("max_update_bytes", self.max_update_bytes),
            ("max_snapshot_bytes", self.max_snapshot_bytes),
            ("max_awareness_bytes", self.max_awareness_bytes),
            ("awareness_per_second", u64::from(self.awareness_per_second)),
        ]
        .into_iter()
        .find(|(_, value)| *value == 0);
        match zero {
            Some((name, _)) => Err(format!("[documents] {name} must be greater than zero")),
            None => Ok(()),
        }
    }
}

/// What a kernel holds for the relay: its configuration, and the awareness rate limiter, whose
/// buckets every clone of the kernel shares.
#[derive(Clone)]
pub struct DocumentsRelay {
    pub config: DocumentsConfig,
    pub(crate) awareness_limiter: RateLimiter,
}

impl DocumentsRelay {
    /// Refuses a configuration `validate` refuses.
    pub fn new(config: DocumentsConfig) -> Result<Self, String> {
        config.validate()?;
        Ok(Self {
            config,
            awareness_limiter: RateLimiter::new(
                config.awareness_per_second,
                Duration::from_secs(1),
            ),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config() -> DocumentsConfig {
        DocumentsConfig {
            max_updates_per_pull: 1,
            snapshot_min_updates: 1,
            max_update_bytes: 1,
            max_snapshot_bytes: 1,
            max_awareness_bytes: 1,
            awareness_per_second: 1,
        }
    }

    #[test]
    fn every_bound_must_be_positive() {
        assert!(config().validate().is_ok());
        let zeroed = [
            DocumentsConfig {
                max_updates_per_pull: 0,
                ..config()
            },
            DocumentsConfig {
                snapshot_min_updates: 0,
                ..config()
            },
            DocumentsConfig {
                max_update_bytes: 0,
                ..config()
            },
            DocumentsConfig {
                max_snapshot_bytes: 0,
                ..config()
            },
            DocumentsConfig {
                max_awareness_bytes: 0,
                ..config()
            },
            DocumentsConfig {
                awareness_per_second: 0,
                ..config()
            },
        ];
        for bad in zeroed {
            assert!(bad.validate().is_err(), "accepted {bad:?}");
        }
    }

    #[test]
    fn a_missing_key_is_a_parse_error_not_a_default() {
        let parsed: Result<DocumentsConfig, _> = toml::from_str(
            "max_updates_per_pull = 1\nsnapshot_min_updates = 1\nmax_update_bytes = 1\n\
             max_snapshot_bytes = 1\nmax_awareness_bytes = 1\n",
        );
        assert!(parsed.is_err(), "awareness_per_second was defaulted");
    }
}
