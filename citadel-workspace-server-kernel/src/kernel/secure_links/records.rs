//! What the secure-link store keeps, and under which keys.
//!
//! - `citadel_workspace.links.by_digest.<hex>`: one link, keyed by its token's SHA-256.
//! - `citadel_workspace.links.index.<username>`: the digests of that member's links.
//! - `citadel_workspace.links.expiry`: every link's expiry, owner and digest, earliest first,
//!   which the purge walks and the quota counts.

use citadel_workspace_types::secure_links::{LinkGrant, SecureLinkInfo};
use serde::{Deserialize, Serialize};

const PREFIX: &str = "citadel_workspace.links.";

pub(crate) const EXPIRY_KEY: &str = "citadel_workspace.links.expiry";

pub(crate) fn record_key(digest: &str) -> String {
    format!("{PREFIX}by_digest.{digest}")
}

pub(crate) fn index_key(owner: &str) -> String {
    format!("{PREFIX}index.{owner}")
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
}

/// One line of the expiry index. Ordered by expiry first, so the purge reads from the front.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub(crate) struct ExpiryEntry {
    pub expires_ms: u64,
    pub digest: String,
    pub owner: String,
}
