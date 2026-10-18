//! How many live secure links a workspace's members may hold, and who says.
//!
//! The kernel does not know the workspace's plan; the host does. A hosted tenant's Durable
//! Object answers from its stored entitlements, a native server from its `kernel.toml`. Both
//! pass a `LinkQuotaSource` when they build the kernel. A kernel built with none makes no links:
//! there is no default limit.
//!
//! Each member has `per_member` links of their own. Links past that draw on one `pool` the whole
//! workspace shares. A link is tagged with where it came from when it is made, and keeps the tag:
//! `pool_used` counts the live links tagged as the pool's.

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

/// What a member and the workspace hold now: the member's live links from their own allowance,
/// and the live links from the pool, everyone's.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LinkUsage {
    pub own_live: u32,
    pub pool_used: u32,
}

/// Where a new link comes from.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LinkSource {
    Own,
    Pool,
}

impl LinkUsage {
    /// Where the member's next link comes from: their own allowance first, then the pool, or
    /// nowhere when both are used up.
    pub fn draw(&self, quota: LinkQuota) -> Option<LinkSource> {
        if self.own_live < quota.per_member {
            Some(LinkSource::Own)
        } else if self.pool_used < quota.pool {
            Some(LinkSource::Pool)
        } else {
            None
        }
    }
}
