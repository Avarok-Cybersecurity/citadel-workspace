//! How an app storage write may grow the workspace's storage and in what order it lands (R4.5),
//! pure.
//!
//! - **The tenant's entitlement.** App storage counts toward the plan's storage (`storage_gb`),
//!   read through the same host answer RE-VFS uploads are (`kernel::limit`): a byte count, or no
//!   limit for an unlimited tenant. A write that would take the workspace's app storage past it
//!   is refused; one that shrinks it never is, so a tenant over its limit can still delete.
//! - **No orphans.** Bytes are only ever written under a record that already names them: a KV
//!   write saves an index covering both the old and the new keys before any value, and a blob is
//!   entered in its root's ledger before any chunk. A write that fails part-way leaves bytes the
//!   index or ledger still names, which a later write, delete or purge removes.
//! - **`sys/` keys** are the host's own (`storage::RESERVED_PREFIX`): an app neither writes, reads
//!   nor lists them.

use super::storage::{KvIndex, StorageRefusal, RESERVED_PREFIX};
use citadel_sdk::prelude::StorageQuota;
use citadel_workspace_types::apps_protocol::ARTIFACT_CHUNK_BYTES;

/// What an app is told when a write would exceed the tenant's storage.
pub const OVER_ENTITLEMENT: &str = "storage_gb";

/// Whether a write taking one root from `current` to `next` bytes fits `quota`, with `others`
/// bytes held by every other root.
pub fn within_entitlement(
    others: u64,
    current: u64,
    next: u64,
    quota: StorageQuota,
) -> Result<(), StorageRefusal> {
    if next <= current {
        return Ok(());
    }
    match quota {
        StorageQuota::Unlimited => Ok(()),
        StorageQuota::Bytes(limit) if others.saturating_add(next) > limit => {
            Err(StorageRefusal::Limit(OVER_ENTITLEMENT))
        }
        StorageQuota::Bytes(_) => Ok(()),
    }
}

/// The index saved before a write's values: every key `old` or `next` holds, each at the larger
/// of its lengths, so whatever the write has put down so far is named by it.
pub fn staged(old: &KvIndex, next: &KvIndex) -> KvIndex {
    let mut staged = old.clone();
    for (key, len) in &next.keys {
        let held = staged.keys.entry(key.clone()).or_insert(0);
        *held = (*held).max(*len);
    }
    staged
}

/// Whether an app may see `key`: not one of the host's own.
pub fn app_visible(key: &str) -> bool {
    !key.starts_with(RESERVED_PREFIX)
}

/// How many chunks a blob of `len` bytes is stored in, from its length alone, so a blob whose
/// meta never landed can still be deleted.
pub fn chunk_count(len: u64) -> u32 {
    let chunks = len.div_ceil(u64::from(ARTIFACT_CHUNK_BYTES));
    u32::try_from(chunks).unwrap_or(u32::MAX)
}
