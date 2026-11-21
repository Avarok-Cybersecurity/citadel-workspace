//! A channel's reactions and read cursors, kept beside its message pages.
//!
//! Reactions live on the stored message, so `GetGroupMessages` returns them with the text and a
//! reader who opens the channel later sees what everyone else saw. Read cursors are one per
//! (channel, member) under their own key, written far more often than messages and never part of
//! a message. Both go through the channel's lock, like every writer of its pages.

use super::group_message_pages::{self, read_cursors_key};
use super::BackendTransactionManager;
use citadel_sdk::prelude::{NetworkError, Ratchet};
use citadel_workspace_types::group_chat::{GroupReaction, GroupReadCursor};
use std::collections::BTreeMap;

/// What a reaction change came to.
#[derive(Debug, PartialEq, Eq)]
pub enum ReactionWrite {
    /// The message's reactions after the change.
    Applied(Vec<GroupReaction>),
    /// No message by that id in the channel.
    NoSuchMessage,
    /// The change was refused; the reason is for the requester.
    Refused(String),
}

impl<R: Ratchet + Send + Sync + 'static> BackendTransactionManager<R> {
    /// Applies `change` to one message's reactions and stores the result.
    pub async fn change_group_message_reactions(
        &self,
        group_id: &str,
        message_id: &str,
        change: impl FnOnce(&[GroupReaction]) -> Result<Vec<GroupReaction>, String>,
    ) -> Result<ReactionWrite, NetworkError> {
        let lock = self.group_lock(group_id);
        let _guard = lock.lock().await;
        let mut pages = self.load_group_pages(group_id).await?;
        let Some((page, offset)) = group_message_pages::locate(&pages, message_id) else {
            return Ok(ReactionWrite::NoSuchMessage);
        };
        let next = match change(&pages[page][offset].reactions) {
            Ok(next) => next,
            Err(reason) => return Ok(ReactionWrite::Refused(reason)),
        };
        pages[page][offset].reactions = next.clone();
        self.backend_save(&group_message_pages::page_key(group_id, page), &pages[page])
            .await?;
        Ok(ReactionWrite::Applied(next))
    }

    /// Moves `member`'s cursor in `group_id` to `upto_message_id`.
    pub async fn set_group_read_cursor(
        &self,
        group_id: &str,
        member: &str,
        upto_message_id: &str,
    ) -> Result<(), NetworkError> {
        let lock = self.group_lock(group_id);
        let _guard = lock.lock().await;
        let key = read_cursors_key(group_id);
        let mut cursors: BTreeMap<String, String> =
            self.backend_get(&key).await?.unwrap_or_default();
        cursors.insert(member.to_string(), upto_message_id.to_string());
        self.backend_save(&key, &cursors).await
    }

    /// Every member's cursor in `group_id`, ordered by member.
    pub async fn group_read_cursors(
        &self,
        group_id: &str,
    ) -> Result<Vec<GroupReadCursor>, NetworkError> {
        let cursors: BTreeMap<String, String> = self
            .backend_get(&read_cursors_key(group_id))
            .await?
            .unwrap_or_default();
        Ok(cursors
            .into_iter()
            .map(|(member, upto_message_id)| GroupReadCursor {
                member,
                upto_message_id,
            })
            .collect())
    }
}
