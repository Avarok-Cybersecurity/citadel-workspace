//! The booking-guest reads (Calendar design §3.6.4): which live links name an account as a guest,
//! and who the guests are. A guest's access is the link record itself (`LinkRecord.guests`), so
//! these read records and decide nothing (`kernel::secure_links::guests` decides).
//!
//! `BOOKING_LINKS_KEY` lists the digests of the links that carry a booking grant, so a question
//! about guests reads those records and not every link. It is written with the links, under
//! `LINKS_LOCK`; reads take no lock, as a token's read does not, because each record is read whole.

use super::BackendTransactionManager;
use crate::kernel::secure_links::guests::{guest_nodes, live_guests};
use crate::kernel::secure_links::records::{LinkRecord, BOOKING_LINKS_KEY};
use citadel_sdk::prelude::{NetworkError, Ratchet};
use std::collections::BTreeSet;

impl<R: Ratchet + Send + Sync + 'static> BackendTransactionManager<R> {
    pub(crate) async fn booking_link_digests(&self) -> Result<BTreeSet<String>, NetworkError> {
        let stored: Option<Vec<String>> = self.backend_get(BOOKING_LINKS_KEY).await?;
        Ok(stored.unwrap_or_default().into_iter().collect())
    }

    async fn save_booking_link_digests(
        &self,
        digests: &BTreeSet<String>,
    ) -> Result<(), NetworkError> {
        if digests.is_empty() {
            return self.backend_delete(BOOKING_LINKS_KEY).await;
        }
        let ordered: Vec<&String> = digests.iter().collect();
        self.backend_save(BOOKING_LINKS_KEY, &ordered).await
    }

    /// Lists a new link that carries a booking grant. The caller holds `LINKS_LOCK`.
    pub(crate) async fn remember_booking_link(
        &self,
        record: &LinkRecord,
    ) -> Result<(), NetworkError> {
        if !record.admits_guests() {
            return Ok(());
        }
        let mut digests = self.booking_link_digests().await?;
        if digests.insert(record.digest.clone()) {
            self.save_booking_link_digests(&digests).await?;
        }
        Ok(())
    }

    /// Unlists links that went. The caller holds `LINKS_LOCK`.
    pub(crate) async fn forget_booking_links<'a>(
        &self,
        gone: impl IntoIterator<Item = &'a str>,
    ) -> Result<(), NetworkError> {
        let mut digests = self.booking_link_digests().await?;
        let before = digests.len();
        for digest in gone {
            digests.remove(digest);
        }
        if digests.len() != before {
            self.save_booking_link_digests(&digests).await?;
        }
        Ok(())
    }

    /// Every stored link with a booking grant, live or not yet purged.
    async fn booking_links(&self) -> Result<Vec<LinkRecord>, NetworkError> {
        let mut links = Vec::new();
        for digest in self.booking_link_digests().await? {
            if let Some(record) = self.link_by_digest(&digest).await? {
                links.push(record);
            }
        }
        Ok(links)
    }

    /// The nodes `user_id` is a guest of at `now_ms`.
    pub(crate) async fn live_guest_nodes(
        &self,
        user_id: &str,
        now_ms: u64,
    ) -> Result<BTreeSet<String>, NetworkError> {
        let links = self.booking_links().await?;
        Ok(guest_nodes(&links, user_id, now_ms)
            .into_iter()
            .map(str::to_string)
            .collect())
    }

    /// Every account a live link names as a guest at `now_ms`.
    pub(crate) async fn live_guest_users(
        &self,
        now_ms: u64,
    ) -> Result<BTreeSet<String>, NetworkError> {
        let links = self.booking_links().await?;
        Ok(live_guests(&links, now_ms)
            .into_iter()
            .map(str::to_string)
            .collect())
    }
}
