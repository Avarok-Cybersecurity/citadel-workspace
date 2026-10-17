//! Secure links: a random token the server maps to an in-app deep link, for the people its
//! creator names and for a bounded time.
//!
//! A link hides where it points; it never grants anything. After its grant check passes, the
//! visitor is sent to the target, which enforces its own permissions as for anyone else.
//!
//! `rules` decides, `target` says what a link may open, `token` mints and hashes tokens, `quota`
//! is the host's limit, `records` the stored shapes; the store is
//! `kernel::transaction::secure_links_store` and the request handler
//! `command_processor::secure_links`. Below are the host's entry points: the purge, for a
//! Durable Object alarm or a native timer.

pub mod quota;
pub mod records;
pub mod rules;
pub mod target;
pub mod token;

#[cfg(test)]
mod store_tests;

use crate::kernel::async_kernel::AsyncWorkspaceServerKernel;
use crate::kernel::transaction::secure_links_store::LINKS_LOCK;
use citadel_sdk::prelude::{NetworkError, Ratchet};

/// How many expired links one purge pass removes at most. A pass is a handful of storage
/// writes per link, so this keeps one alarm's work bounded; the host runs another pass soon
/// when more remain.
pub const PURGE_BATCH: u32 = 200;

/// How often a host purges expired links: hourly.
pub const PURGE_INTERVAL_MS: u64 = 60 * 60 * 1000;

impl<R: Ratchet + Send + Sync + 'static> AsyncWorkspaceServerKernel<R> {
    /// Remove up to `max_entries` links expired as of `now_ms` (Unix ms, the host's clock),
    /// with their index entries. Returns how many expired links remain for another pass.
    /// Expiry is enforced on every read; this only reclaims space.
    pub async fn purge_expired_links(
        &self,
        now_ms: u64,
        max_entries: u32,
    ) -> Result<u32, NetworkError> {
        let _guard = LINKS_LOCK.lock().await;
        self.domain_operations
            .backend_tx_manager
            .purge_expired_links(now_ms, max_entries)
            .await
    }
}
