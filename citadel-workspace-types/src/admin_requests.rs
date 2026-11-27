//! Asking the workspace's admins for something: a member's one sentence, delivered as a note in
//! each admin's Scratchpad (REL-1127 owner decision: "Just land a message inside the user's
//! scratchpad!"). The server stamps who asked and when, keeps each admin's pending asks in their
//! user record until one of their clients has written them to its scratchpad and acknowledged
//! them, and nudges the admins' live sessions.
//!
//! Pure: the inbox rules below read and return values; the kernel does the storage.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Key of an admin's pending asks in `User.metadata`, as a JSON string of `Vec<AdminRequestEntry>`.
pub const ADMIN_REQUESTS_KEY: &str = "admin_requests_pending";
/// Key of the last time a member asked, in `User.metadata`, as Unix ms.
pub const ADMIN_ASK_LAST_KEY: &str = "admin_ask_last_ms";
/// Longest ask, in characters.
pub const MAX_ADMIN_REQUEST_CHARS: usize = 600;
/// Most asks one admin holds; the oldest goes first.
pub const MAX_PENDING_ADMIN_REQUESTS: usize = 100;
/// How long a member waits between asks.
pub const ADMIN_ASK_INTERVAL_MS: u64 = 60_000;

/// One ask as an admin receives it. `from_user` and `at_ms` are the server's, never the asker's.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AdminRequestEntry {
    pub id: String,
    pub from_user: String,
    #[ts(type = "bigint")]
    pub at_ms: u64,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum AdminRequestsRequest {
    /// Any member: sends `text` to every member who may edit the workspace's configuration.
    Ask { text: String },
    /// The caller's own pending asks, oldest first.
    Take,
    /// The caller has written these to its scratchpad; they are deleted.
    Ack { ids: Vec<String> },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum AdminAskRefusal {
    Empty,
    TooLong,
    /// Nobody but the asker may edit the workspace's configuration.
    NoAdmins,
    /// Asked again within `ADMIN_ASK_INTERVAL_MS`.
    TooSoon,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum AdminRequestsResponse {
    Asked {
        admins: u32,
    },
    /// Pushed to an admin's sessions: there is something to take.
    Waiting,
    Pending {
        entries: Vec<AdminRequestEntry>,
    },
    Acked {
        removed: u32,
    },
    Refused(AdminAskRefusal),
}

/// The ask's text as stored, or why it is refused. Surrounding whitespace is not kept.
pub fn checked_ask(text: &str) -> Result<String, AdminAskRefusal> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Err(AdminAskRefusal::Empty);
    }
    if trimmed.chars().count() > MAX_ADMIN_REQUEST_CHARS {
        return Err(AdminAskRefusal::TooLong);
    }
    Ok(trimmed.to_string())
}

/// Whether a member who last asked at `last_ms` may ask at `now_ms`.
pub fn may_ask_again(last_ms: Option<u64>, now_ms: u64) -> bool {
    match last_ms {
        None => true,
        Some(last) => now_ms.saturating_sub(last) >= ADMIN_ASK_INTERVAL_MS,
    }
}

/// `pending` with `entry` added, holding at most `MAX_PENDING_ADMIN_REQUESTS`, oldest dropped.
pub fn with_entry(
    mut pending: Vec<AdminRequestEntry>,
    entry: AdminRequestEntry,
) -> Vec<AdminRequestEntry> {
    pending.push(entry);
    let over = pending.len().saturating_sub(MAX_PENDING_ADMIN_REQUESTS);
    pending.drain(..over);
    pending
}

/// `pending` without the entries named in `ids`, and how many were removed.
pub fn without_ids(
    pending: Vec<AdminRequestEntry>,
    ids: &[String],
) -> (Vec<AdminRequestEntry>, u32) {
    let before = pending.len();
    let kept: Vec<AdminRequestEntry> = pending
        .into_iter()
        .filter(|e| !ids.contains(&e.id))
        .collect();
    let removed = u32::try_from(before - kept.len()).unwrap_or(u32::MAX);
    (kept, removed)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(id: &str) -> AdminRequestEntry {
        AdminRequestEntry {
            id: id.to_string(),
            from_user: "alice".to_string(),
            at_ms: 1,
            text: "x".to_string(),
        }
    }

    #[test]
    fn an_ask_is_trimmed_and_bounded() {
        assert_eq!(checked_ask("  please  "), Ok("please".to_string()));
        assert_eq!(checked_ask(" \n "), Err(AdminAskRefusal::Empty));
        assert_eq!(
            checked_ask(&"a".repeat(MAX_ADMIN_REQUEST_CHARS)).map(|t| t.len()),
            Ok(MAX_ADMIN_REQUEST_CHARS)
        );
        assert_eq!(
            checked_ask(&"a".repeat(MAX_ADMIN_REQUEST_CHARS + 1)),
            Err(AdminAskRefusal::TooLong)
        );
    }

    #[test]
    fn a_member_asks_at_most_once_a_minute() {
        assert!(may_ask_again(None, 5));
        assert!(!may_ask_again(
            Some(1_000),
            1_000 + ADMIN_ASK_INTERVAL_MS - 1
        ));
        assert!(may_ask_again(Some(1_000), 1_000 + ADMIN_ASK_INTERVAL_MS));
    }

    #[test]
    fn a_full_inbox_drops_its_oldest_ask() {
        let full: Vec<AdminRequestEntry> = (0..MAX_PENDING_ADMIN_REQUESTS)
            .map(|i| entry(&i.to_string()))
            .collect();
        let next = with_entry(full, entry("new"));
        assert_eq!(next.len(), MAX_PENDING_ADMIN_REQUESTS);
        assert_eq!(next.first().map(|e| e.id.as_str()), Some("1"));
        assert_eq!(next.last().map(|e| e.id.as_str()), Some("new"));
    }

    #[test]
    fn an_ack_removes_only_what_it_names() {
        let (kept, removed) = without_ids(
            vec![entry("a"), entry("b")],
            &["a".to_string(), "zz".to_string()],
        );
        assert_eq!(removed, 1);
        assert_eq!(kept, vec![entry("b")]);
    }
}
