//! The secure-link store's I/O: each link under its token's digest, each member's list of
//! digests, and one expiry index. Nothing is decided here (`kernel::secure_links::rules`).
//!
//! Every read-modify-write is made under `LINKS_LOCK`, which the caller takes: an index is one
//! record, so two writers interleaving would lose one's change, and a one-time link must be read
//! and deleted with nobody else between.

use super::BackendTransactionManager;
use crate::kernel::secure_links::quota::LinkUsage;
use crate::kernel::secure_links::records::{
    index_key, record_key, ExpiryEntry, LinkRecord, EXPIRY_KEY,
};
use citadel_sdk::prelude::{NetworkError, Ratchet};
use std::collections::BTreeSet;

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

    /// The digests of `owner`'s links, live or not yet purged.
    pub(crate) async fn link_digests_of(&self, owner: &str) -> Result<Vec<String>, NetworkError> {
        Ok(self
            .backend_get(&index_key(owner))
            .await?
            .unwrap_or_default())
    }

    pub(crate) async fn link_expiry(&self) -> Result<BTreeSet<ExpiryEntry>, NetworkError> {
        let stored: Option<Vec<ExpiryEntry>> = self.backend_get(EXPIRY_KEY).await?;
        Ok(stored.unwrap_or_default().into_iter().collect())
    }

    async fn save_link_expiry(&self, expiry: &BTreeSet<ExpiryEntry>) -> Result<(), NetworkError> {
        let ordered: Vec<&ExpiryEntry> = expiry.iter().collect();
        self.backend_save(EXPIRY_KEY, &ordered).await
    }

    async fn save_link_digests(&self, owner: &str, digests: &[String]) -> Result<(), NetworkError> {
        if digests.is_empty() {
            return self.backend_delete(&index_key(owner)).await;
        }
        self.backend_save(&index_key(owner), &digests).await
    }

    /// Every member's live links at `now_ms`, from the expiry index alone.
    pub(crate) async fn link_usage(&self, now_ms: u64) -> Result<LinkUsage, NetworkError> {
        let mut usage = LinkUsage::default();
        for entry in self.link_expiry().await? {
            if entry.expires_ms > now_ms {
                usage.count(&entry.owner);
            }
        }
        Ok(usage)
    }

    /// Store a new link: the record, then its owner's index, then the expiry index.
    pub(crate) async fn insert_link(&self, record: &LinkRecord) -> Result<(), NetworkError> {
        self.backend_save(&record_key(&record.digest), record)
            .await?;
        let mut digests = self.link_digests_of(&record.owner).await?;
        if !digests.contains(&record.digest) {
            digests.push(record.digest.clone());
        }
        self.save_link_digests(&record.owner, &digests).await?;
        let mut expiry = self.link_expiry().await?;
        expiry.insert(record.expiry_entry());
        self.save_link_expiry(&expiry).await
    }

    /// Rewrite a link under the same digest, moving its expiry entry if that changed.
    pub(crate) async fn update_link(
        &self,
        before: &LinkRecord,
        after: &LinkRecord,
    ) -> Result<(), NetworkError> {
        self.backend_save(&record_key(&after.digest), after).await?;
        if before.expires_ms != after.expires_ms {
            let mut expiry = self.link_expiry().await?;
            expiry.remove(&before.expiry_entry());
            expiry.insert(after.expiry_entry());
            self.save_link_expiry(&expiry).await?;
        }
        Ok(())
    }

    /// Remove a link: its record first, so its token stops working before anything else.
    pub(crate) async fn remove_link(&self, record: &LinkRecord) -> Result<(), NetworkError> {
        self.backend_delete(&record_key(&record.digest)).await?;
        let mut digests = self.link_digests_of(&record.owner).await?;
        digests.retain(|d| *d != record.digest);
        self.save_link_digests(&record.owner, &digests).await?;
        let mut expiry = self.link_expiry().await?;
        expiry.remove(&record.expiry_entry());
        self.save_link_expiry(&expiry).await
    }

    /// Remove up to `max_entries` links expired at `now_ms`, earliest first. Returns how many
    /// expired links remain for a later pass.
    pub(crate) async fn purge_expired_links(
        &self,
        now_ms: u64,
        max_entries: u32,
    ) -> Result<u32, NetworkError> {
        let mut expiry = self.link_expiry().await?;
        let expired: Vec<ExpiryEntry> = expiry
            .iter()
            .take_while(|entry| entry.expires_ms <= now_ms)
            .cloned()
            .collect();
        let batch = expired.len().min(max_entries as usize);
        let mut owners: BTreeSet<&str> = BTreeSet::new();
        for entry in &expired[..batch] {
            self.backend_delete(&record_key(&entry.digest)).await?;
            owners.insert(&entry.owner);
        }
        for owner in owners {
            let mut digests = self.link_digests_of(owner).await?;
            digests.retain(|d| !expired[..batch].iter().any(|e| e.digest == *d));
            self.save_link_digests(owner, &digests).await?;
        }
        for entry in &expired[..batch] {
            expiry.remove(entry);
        }
        if batch > 0 {
            self.save_link_expiry(&expiry).await?;
        }
        u32::try_from(expired.len() - batch)
            .map_err(|_| NetworkError::msg("More expired links than a u32 counts"))
    }
}
