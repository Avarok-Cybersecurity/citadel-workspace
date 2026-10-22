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
//!
//! Either may be [`Limit::Unlimited`], which only an unlimited tenant's host says (entitlements
//! v2's explicit `null`); a native server's `kernel.toml` sets counts.

pub use crate::kernel::limit::Limit;
use std::sync::Arc;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LinkQuota {
    pub per_member: Limit,
    pub pool: Limit,
}

impl LinkQuota {
    /// Both limits counts, as every finite plan and every native server sets them.
    pub fn counts(per_member: u32, pool: u32) -> Self {
        Self {
            per_member: Limit::At(per_member),
            pool: Limit::At(pool),
        }
    }
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

/// Where the member's next link comes from, or the two limits that are both used up: only
/// counts can be, so an exhausted draw always names two.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Draw {
    From(LinkSource),
    Exhausted { per_member: u32, pool: u32 },
}

impl LinkUsage {
    /// Their own allowance first, then the pool.
    pub fn draw(&self, quota: LinkQuota) -> Draw {
        let per_member = match quota.per_member {
            Limit::At(max) if self.own_live >= max => max,
            _ => return Draw::From(LinkSource::Own),
        };
        let pool = match quota.pool {
            Limit::At(max) if self.pool_used >= max => max,
            _ => return Draw::From(LinkSource::Pool),
        };
        Draw::Exhausted { per_member, pool }
    }
}

#[cfg(test)]
mod tests;
