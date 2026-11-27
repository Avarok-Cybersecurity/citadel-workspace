//! What a node channel's messages carry besides their text: reactions, how far each member has
//! read, and who is typing.
//!
//! The direct chat had all three over the P2P wire and the node chat had none, because the
//! workspace server had no request for any of them. These are those requests' values.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// The fixed set a reaction may be. The chat's picker offers exactly these (the UI's
/// `REACTION_EMOJIS`, which a UI test reads from this file), and anything else is refused, so a
/// stored message can never hold an arbitrary string from a client.
pub const REACTION_EMOJIS: &[&str] = &["👍", "❤️", "😂", "😮", "😢", "🎉"];

/// One reactor's one emoji on a stored message.
///
/// Field names match the direct chat's `Reaction` (`reactorCid`, `at`), so a node message's
/// reactions are the same value the UI already folds and renders for a peer's.
#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq, Eq)]
#[ts(export)]
pub struct GroupReaction {
    pub emoji: String,
    /// The session CID the server attributed the reaction to; CIDs are permanent per account.
    #[serde(rename = "reactorCid")]
    #[ts(type = "bigint")]
    pub reactor_cid: u64,
    /// Server clock, milliseconds, when the reactor last changed this entry. A u64 like every
    /// other, so a bigint on the page (the workspace codec makes every u64 one).
    #[ts(type = "bigint")]
    pub at: u64,
    /// False is a retraction, kept so the entry's history orders later changes.
    pub active: bool,
}

/// How far one member has read a channel: every message up to and including this one.
#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq, Eq)]
#[ts(export)]
pub struct GroupReadCursor {
    /// The member's username.
    pub member: String,
    pub upto_message_id: String,
}

/// One requested change to a message's reactions, attributed by the server.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReactionChange<'a> {
    pub emoji: &'a str,
    pub reactor_cid: u64,
    pub on: bool,
    /// Server clock, milliseconds.
    pub at: u64,
}

/// The reactions after `change`, or why it is refused.
///
/// One entry per (reactor, emoji): an add sets it active, a retraction keeps it inactive, so the
/// entry's clock still orders a late copy of either. Retracting what was never there changes
/// nothing. A reactor only ever touches their own entries, because the server supplies the CID.
pub fn apply_reaction(
    current: &[GroupReaction],
    change: &ReactionChange<'_>,
) -> Result<Vec<GroupReaction>, String> {
    if !REACTION_EMOJIS.contains(&change.emoji) {
        return Err(format!(
            "{} is not one of the reactions this chat offers",
            change.emoji
        ));
    }
    let mut next = current.to_vec();
    match next
        .iter_mut()
        .find(|r| r.reactor_cid == change.reactor_cid && r.emoji == change.emoji)
    {
        Some(entry) => {
            entry.active = change.on;
            entry.at = change.at.max(entry.at);
        }
        None if change.on => next.push(GroupReaction {
            emoji: change.emoji.to_string(),
            reactor_cid: change.reactor_cid,
            at: change.at,
            active: true,
        }),
        None => {}
    }
    Ok(next)
}
