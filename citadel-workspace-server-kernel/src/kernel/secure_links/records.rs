//! What the secure-link store keeps, and under which keys. No value grows with the number of
//! links in the workspace beyond one expiry hour's or one member's own:
//!
//! - `citadel_workspace.links.by_digest.<hex>`: one link, keyed by its token's SHA-256.
//! - `citadel_workspace.links.index.<username>`: that member's links (digest, expiry, and whether
//!   it came from the pool), at most their allowance plus the pool.
//! - `citadel_workspace.links.expiry.<hour>`: the links expiring in that hour since the epoch,
//!   which the purge walks oldest first.
//! - `citadel_workspace.links.expiry_hours`: which hours have a bucket. Links live at most 30
//!   days, so a purged store has at most 721 of them.
//! - `citadel_workspace.links.pool`: the links drawn from the shared pool, at most the pool.

use citadel_workspace_types::secure_links::{LinkGrant, SecureLinkInfo};
use serde::{Deserialize, Serialize};

const PREFIX: &str = "citadel_workspace.links.";

pub(crate) const EXPIRY_HOURS_KEY: &str = "citadel_workspace.links.expiry_hours";
pub(crate) const POOL_KEY: &str = "citadel_workspace.links.pool";

const HOUR_MS: u64 = 60 * 60 * 1000;

pub(crate) fn record_key(digest: &str) -> String {
    format!("{PREFIX}by_digest.{digest}")
}

pub(crate) fn index_key(owner: &str) -> String {
    format!("{PREFIX}index.{owner}")
}

pub(crate) fn bucket_key(hour: u64) -> String {
    format!("{PREFIX}expiry.{hour}")
}

/// The expiry bucket a time falls in: hours since the epoch.
pub(crate) fn hour_of(ms: u64) -> u64 {
    ms / HOUR_MS
}

/// One link. The token itself is never stored; `digest` is its SHA-256.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LinkRecord {
    pub digest: String,
    pub id: String,
    pub owner: String,
    pub target: String,
    pub label: String,
    pub grants: Vec<LinkGrant>,
    pub one_time: bool,
    pub created_ms: u64,
    pub expires_ms: u64,
    pub uses: u32,
    pub last_used_ms: Option<u64>,
    /// Drawn from the workspace's shared pool, because its owner had used their own allowance
    /// when it was made. Fixed for the link's life: an own link expiring does not move it.
    pub from_pool: bool,
}

impl LinkRecord {
    /// Live at `now_ms`: expiry is checked on every read, the purge only reclaims space.
    pub fn live_at(&self, now_ms: u64) -> bool {
        self.expires_ms > now_ms
    }

    pub fn info(&self) -> SecureLinkInfo {
        SecureLinkInfo {
            id: self.id.clone(),
            target: self.target.clone(),
            label: self.label.clone(),
            grants: self.grants.clone(),
            one_time: self.one_time,
            created_ms: self.created_ms,
            expires_ms: self.expires_ms,
            uses: self.uses,
            last_used_ms: self.last_used_ms,
        }
    }

    pub(crate) fn expiry_entry(&self) -> ExpiryEntry {
        ExpiryEntry {
            expires_ms: self.expires_ms,
            digest: self.digest.clone(),
            owner: self.owner.clone(),
        }
    }

    pub(crate) fn index_entry(&self) -> IndexEntry {
        IndexEntry {
            digest: self.digest.clone(),
            expires_ms: self.expires_ms,
            from_pool: self.from_pool,
        }
    }

    pub(crate) fn pool_entry(&self) -> PoolEntry {
        PoolEntry {
            expires_ms: self.expires_ms,
            digest: self.digest.clone(),
        }
    }
}

/// One line of an expiry bucket. Ordered by expiry first, so the purge reads from the front.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub(crate) struct ExpiryEntry {
    pub expires_ms: u64,
    pub digest: String,
    pub owner: String,
}

/// One of a member's links, as their index lists it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct IndexEntry {
    pub digest: String,
    pub expires_ms: u64,
    pub from_pool: bool,
}

/// One link holding a place in the shared pool.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub(crate) struct PoolEntry {
    pub expires_ms: u64,
    pub digest: String,
}
