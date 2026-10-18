//! The secure-link store's I/O: each link under its token's digest, each member's index, the
//! expiry buckets (one per hour) and the pool's list (`kernel::secure_links::records`). Nothing is
//! decided here (`kernel::secure_links::rules`).
//!
//! Every read-modify-write is made under `LINKS_LOCK`, which the caller takes: an index is one
//! record, so two writers interleaving would lose one's change, and a one-time link must be read
//! and deleted with nobody else between.

use super::BackendTransactionManager;
use crate::kernel::secure_links::quota::LinkUsage;
use crate::kernel::secure_links::records::{
    bucket_key, hour_of, index_key, record_key, ExpiryEntry, IndexEntry, LinkRecord, PoolEntry,
    EXPIRY_HOURS_KEY, POOL_KEY,
};
use citadel_sdk::prelude::{NetworkError, Ratchet};
use std::collections::{BTreeMap, BTreeSet};

/// Serialises every secure-link read-modify-write. Links are made and opened by people, not
/// machines, so one lock for all of them.
pub(crate) static LINKS_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

impl<R: Ratchet + Send + Sync + 'static> BackendTransactionManager<R> {
    pub(crate) async fn link_by_digest(
        &self,
        digest: &str,
    ) -> Result<Option<LinkRecord>, NetworkError> {
        self.backend_get(&record_key(digest)).await
    }

    /// `owner`'s links, live or not yet purged.
    pub(crate) async fn link_index(&self, owner: &str) -> Result<Vec<IndexEntry>, NetworkError> {
        Ok(self
            .backend_get(&index_key(owner))
            .await?
            .unwrap_or_default())
    }

    async fn save_link_index(&self, owner: &str, index: &[IndexEntry]) -> Result<(), NetworkError> {
        if index.is_empty() {
            return self.backend_delete(&index_key(owner)).await;
        }
        self.backend_save(&index_key(owner), &index).await
    }

    async fn link_pool(&self) -> Result<BTreeSet<PoolEntry>, NetworkError> {
        let stored: Option<Vec<PoolEntry>> = self.backend_get(POOL_KEY).await?;
        Ok(stored.unwrap_or_default().into_iter().collect())
    }

    async fn save_link_pool(&self, pool: &BTreeSet<PoolEntry>) -> Result<(), NetworkError> {
        let ordered: Vec<&PoolEntry> = pool.iter().collect();
        self.backend_save(POOL_KEY, &ordered).await
    }

    pub(crate) async fn link_hours(&self) -> Result<BTreeSet<u64>, NetworkError> {
        let stored: Option<Vec<u64>> = self.backend_get(EXPIRY_HOURS_KEY).await?;
        Ok(stored.unwrap_or_default().into_iter().collect())
    }

    pub(crate) async fn link_bucket(
        &self,
        hour: u64,
    ) -> Result<BTreeSet<ExpiryEntry>, NetworkError> {
        let stored: Option<Vec<ExpiryEntry>> = self.backend_get(&bucket_key(hour)).await?;
        Ok(stored.unwrap_or_default().into_iter().collect())
    }

    /// Store `bucket` as `hour`'s, deleting it and its hour once it is empty.
    async fn save_link_bucket(
        &self,
        hour: u64,
        bucket: &BTreeSet<ExpiryEntry>,
    ) -> Result<(), NetworkError> {
        let mut hours = self.link_hours().await?;
        if bucket.is_empty() {
            self.backend_delete(&bucket_key(hour)).await?;
            if hours.remove(&hour) {
                self.backend_save(EXPIRY_HOURS_KEY, &hours).await?;
            }
            return Ok(());
        }
        let ordered: Vec<&ExpiryEntry> = bucket.iter().collect();
        self.backend_save(&bucket_key(hour), &ordered).await?;
        if hours.insert(hour) {
            self.backend_save(EXPIRY_HOURS_KEY, &hours).await?;
        }
        Ok(())
    }

    async fn add_to_bucket(&self, entry: ExpiryEntry) -> Result<(), NetworkError> {
        let hour = hour_of(entry.expires_ms);
        let mut bucket = self.link_bucket(hour).await?;
        bucket.insert(entry);
        self.save_link_bucket(hour, &bucket).await
    }

    async fn remove_from_bucket(&self, entry: &ExpiryEntry) -> Result<(), NetworkError> {
        let hour = hour_of(entry.expires_ms);
        let mut bucket = self.link_bucket(hour).await?;
        if bucket.remove(entry) {
            self.save_link_bucket(hour, &bucket).await?;
        }
        Ok(())
    }

    /// What `owner` and the workspace hold at `now_ms`: their live own links, and the pool's.
    pub(crate) async fn link_usage(
        &self,
        owner: &str,
        now_ms: u64,
    ) -> Result<LinkUsage, NetworkError> {
        let own_live = self
            .link_index(owner)
            .await?
            .iter()
            .filter(|entry| !entry.from_pool && entry.expires_ms > now_ms)
            .count();
        let pool_used = self
            .link_pool()
            .await?
            .iter()
            .filter(|entry| entry.expires_ms > now_ms)
            .count();
        let count = |n: usize| u32::try_from(n).map_err(|_| NetworkError::msg("Too many links"));
        Ok(LinkUsage {
            own_live: count(own_live)?,
            pool_used: count(pool_used)?,
        })
    }

    /// Store a new link: the record first, then its owner's index, its bucket and the pool.
    pub(crate) async fn insert_link(&self, record: &LinkRecord) -> Result<(), NetworkError> {
        self.backend_save(&record_key(&record.digest), record)
            .await?;
        let mut index = self.link_index(&record.owner).await?;
        index.retain(|entry| entry.digest != record.digest);
        index.push(record.index_entry());
        self.save_link_index(&record.owner, &index).await?;
        self.add_to_bucket(record.expiry_entry()).await?;
        if record.from_pool {
            let mut pool = self.link_pool().await?;
            pool.insert(record.pool_entry());
            self.save_link_pool(&pool).await?;
        }
        Ok(())
    }

    /// Rewrite a link under the same digest, moving its expiry wherever it is listed.
    pub(crate) async fn update_link(
        &self,
        before: &LinkRecord,
        after: &LinkRecord,
    ) -> Result<(), NetworkError> {
        self.backend_save(&record_key(&after.digest), after).await?;
        if before.expires_ms == after.expires_ms {
            return Ok(());
        }
        let mut index = self.link_index(&after.owner).await?;
        for entry in index.iter_mut().filter(|e| e.digest == after.digest) {
            entry.expires_ms = after.expires_ms;
        }
        self.save_link_index(&after.owner, &index).await?;
        self.remove_from_bucket(&before.expiry_entry()).await?;
        self.add_to_bucket(after.expiry_entry()).await?;
        if after.from_pool {
            let mut pool = self.link_pool().await?;
            pool.remove(&before.pool_entry());
            pool.insert(after.pool_entry());
            self.save_link_pool(&pool).await?;
        }
        Ok(())
    }

    /// Remove a link: its record first, so its token stops working before anything else.
    pub(crate) async fn remove_link(&self, record: &LinkRecord) -> Result<(), NetworkError> {
        self.backend_delete(&record_key(&record.digest)).await?;
        let mut index = self.link_index(&record.owner).await?;
        index.retain(|entry| entry.digest != record.digest);
        self.save_link_index(&record.owner, &index).await?;
        self.remove_from_bucket(&record.expiry_entry()).await?;
        if record.from_pool {
            let mut pool = self.link_pool().await?;
            if pool.remove(&record.pool_entry()) {
                self.save_link_pool(&pool).await?;
            }
        }
        Ok(())
    }

    /// Remove up to `max_entries` links expired at `now_ms`, oldest bucket first. Returns how
    /// many expired links remain for a later pass.
    pub(crate) async fn purge_expired_links(
        &self,
        now_ms: u64,
        max_entries: u32,
    ) -> Result<u32, NetworkError> {
        let mut budget = max_entries as usize;
        let mut remaining = 0usize;
        let mut purged: Vec<ExpiryEntry> = Vec::new();
        let past: Vec<u64> = self
            .link_hours()
            .await?
            .into_iter()
            .take_while(|hour| *hour <= hour_of(now_ms))
            .collect();
        for hour in past {
            let mut bucket = self.link_bucket(hour).await?;
            let expired: Vec<ExpiryEntry> = bucket
                .iter()
                .take_while(|entry| entry.expires_ms <= now_ms)
                .cloned()
                .collect();
            let taken = expired.len().min(budget);
            remaining += expired.len() - taken;
            if taken == 0 {
                continue;
            }
            budget -= taken;
            for entry in &expired[..taken] {
                self.backend_delete(&record_key(&entry.digest)).await?;
                bucket.remove(entry);
            }
            self.save_link_bucket(hour, &bucket).await?;
            purged.extend_from_slice(&expired[..taken]);
        }
        let mut by_owner: BTreeMap<&str, BTreeSet<&str>> = BTreeMap::new();
        for entry in &purged {
            by_owner
                .entry(&entry.owner)
                .or_default()
                .insert(&entry.digest);
        }
        for (owner, digests) in &by_owner {
            let mut index = self.link_index(owner).await?;
            index.retain(|entry| !digests.contains(entry.digest.as_str()));
            self.save_link_index(owner, &index).await?;
        }
        let mut pool = self.link_pool().await?;
        let before = pool.len();
        pool.retain(|entry| entry.expires_ms > now_ms);
        if pool.len() != before {
            self.save_link_pool(&pool).await?;
        }
        u32::try_from(remaining).map_err(|_| NetworkError::msg("More expired links than a u32"))
    }
}
