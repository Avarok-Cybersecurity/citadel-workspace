//! How many live secure links a workspace's members may hold, and who says.
//!
//! The kernel does not know the workspace's plan; the host does. A hosted tenant's Durable
//! Object answers from its stored entitlements, a native server from its `kernel.toml`. Both
//! pass a `LinkQuotaSource` when they build the kernel. A kernel built with none makes no links:
//! there is no default limit.
//!
//! Each member has `per_member` links of their own. Links past that draw on one `pool` the whole
//! workspace shares, so `pool_used` is the sum over members of what they hold beyond their own.

use std::collections::BTreeMap;
use std::sync::Arc;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LinkQuota {
    pub per_member: u32,
    pub pool: u32,
}

/// The host could not say, and why. The detail is the host's to log.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LinkQuotaUnavailable(pub String);

/// The host capability that knows the workspace's link limits.
pub trait LinkQuotaSource: Send + Sync {
    fn quota(&self) -> Result<LinkQuota, LinkQuotaUnavailable>;
}

/// The capability as the kernel holds it: absent unless the host passed one.
pub type LinkQuotaSourceHandle = Option<Arc<dyn LinkQuotaSource>>;

/// Limits fixed when the server starts: a native server's, read from `kernel.toml`.
pub struct FixedLinkQuota(pub LinkQuota);

impl LinkQuotaSource for FixedLinkQuota {
    fn quota(&self) -> Result<LinkQuota, LinkQuotaUnavailable> {
        Ok(self.0)
    }
}

/// What the workspace holds now: each member's live links.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct LinkUsage {
    pub live_by_owner: BTreeMap<String, u32>,
}

impl LinkUsage {
    /// Count one live link for `owner`.
    pub fn count(&mut self, owner: &str) {
        *self.live_by_owner.entry(owner.to_string()).or_insert(0) += 1;
    }

    pub fn live_of(&self, owner: &str) -> u32 {
        self.live_by_owner.get(owner).copied().unwrap_or(0)
    }

    /// The pool taken: every member's links beyond their own allowance.
    pub fn pool_used(&self, per_member: u32) -> u32 {
        self.live_by_owner
            .values()
            .map(|live| live.saturating_sub(per_member))
            .fold(0u32, u32::saturating_add)
    }

    /// Whether `owner` may make one more: from their own allowance first, else the pool.
    pub fn admits_another(&self, owner: &str, quota: LinkQuota) -> bool {
        self.live_of(owner) < quota.per_member || self.pool_used(quota.per_member) < quota.pool
    }
}
