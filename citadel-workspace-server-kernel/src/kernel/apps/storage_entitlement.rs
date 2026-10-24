//! Where app storage reads the tenant's storage entitlement: from the node's own backend, as
//! RE-VFS does, so the two can never disagree about it.
//!
//! A host-SQL backend (a Durable Object's SQLite) answers the plan's storage on every RE-VFS
//! upload (`SqlHost::storage_quota`, through `kernel::limit::storage_quota`); app storage asks the
//! same object the same question at every write. Any other backend sets RE-VFS no workspace-wide
//! limit, and so sets app storage none either; each app is still held to its own caps
//! (`storage::quota_of`, `BLOB_QUOTA`).

use citadel_sdk::prelude::{BackendType, SqlHost, StorageQuota};
use std::sync::Arc;

#[derive(Clone)]
pub enum StorageEntitlement {
    /// The host's storage, which answers for the plan.
    Host(Arc<dyn SqlHost>),
    /// A backend with no workspace-wide storage limit.
    Unmetered,
}

impl StorageEntitlement {
    /// The entitlement of the node whose backend is `backend`.
    pub fn of(backend: &BackendType) -> Self {
        match backend {
            BackendType::HostSql(handle) => Self::Host(handle.0.clone()),
            _ => Self::Unmetered,
        }
    }

    /// The entitlement now; `Err` when the host cannot say, which refuses the write asking.
    pub fn quota(&self) -> Result<StorageQuota, String> {
        match self {
            Self::Host(host) => host.storage_quota(),
            Self::Unmetered => Ok(StorageQuota::Unlimited),
        }
    }
}

impl std::fmt::Debug for StorageEntitlement {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Host(_) => f.write_str("StorageEntitlement::Host"),
            Self::Unmetered => f.write_str("StorageEntitlement::Unmetered"),
        }
    }
}
