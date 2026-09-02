//! Where a room's messages live, and which of them a write has to touch.
//!
//! Every message in a room used to live under one key as a single
//! `Vec<GroupMessage>`, so sending one message parsed and re-serialised the
//! whole history: a 10k-message room at ~300B each is ~3MB in and ~3MB out per
//! send, and on the filesystem backend that write is amplified again by the
//! account-file rewrite. Round 517 gave each room its own lock, which bounded
//! the blast radius of that cost to the room paying it; it did not reduce it.
//!
//! Pages fix the send path: an append touches the last page and the index, and
//! nothing else. Readers still concatenate, because `get_group_messages` returns
//! the whole history and that is what its callers ask for.
//!
//! Pure by design — no I/O here. Which page a message belongs to, how a legacy
//! blob splits, and where an id lives are decisions that can be tested without a
//! backend; the reads and writes stay in `BackendTransactionManager`. That is
//! the SBIO split the project asks for, and it is what makes the migration
//! testable at all.

use citadel_workspace_types::GroupMessage;

/// How many messages share a page.
///
/// The send path's cost is one page, so smaller is cheaper per send and costs
/// more reads for a full history. 256 keeps a page around 75KB at the ~300B
/// message size these rooms actually see — small enough that a send is cheap,
/// large enough that a full read of a 10k-message room is 40 gets rather than
/// 10,000.
pub(super) const PAGE_SIZE: usize = 256;

/// The key holding page `n` of a room's history.
pub(super) fn page_key(group_id: &str, page: usize) -> String {
    format!("citadel_workspace.group_messages.{group_id}.page.{page}")
}

/// The key holding how many pages a room has.
///
/// Its presence is also the migration flag: a room with no index has either
/// never been written or is still in the legacy single-blob form, and
/// `legacy_key` decides which.
pub(super) fn index_key(group_id: &str) -> String {
    format!("citadel_workspace.group_messages.{group_id}.pages")
}

/// The pre-paging key: one `Vec<GroupMessage>` for the whole room.
pub(super) fn legacy_key(group_id: &str) -> String {
    format!("citadel_workspace.group_messages.{group_id}")
}

/// Split a legacy blob into pages, preserving order.
///
/// Returns at least one page, so a room that existed with no messages still
/// gets an index and does not look unmigrated on every subsequent write.
pub(super) fn split_into_pages(messages: Vec<GroupMessage>) -> Vec<Vec<GroupMessage>> {
    if messages.is_empty() {
        return vec![Vec::new()];
    }
    messages
        .chunks(PAGE_SIZE)
        .map(<[GroupMessage]>::to_vec)
        .collect()
}

/// Where a new message goes: the last page if it has room, otherwise a new one.
///
/// `last_len` is the length of page `page_count - 1`.
pub(super) fn append_target(page_count: usize, last_len: usize) -> AppendTarget {
    if page_count == 0 || last_len >= PAGE_SIZE {
        AppendTarget {
            page: page_count,
            starts_a_page: true,
        }
    } else {
        AppendTarget {
            page: page_count - 1,
            starts_a_page: false,
        }
    }
}

/// The page an append writes, and whether the index has to grow with it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct AppendTarget {
    pub(super) page: usize,
    pub(super) starts_a_page: bool,
}

/// Find a message by id: which page, and where in it.
///
/// Searched newest page first. An edit or a delete is nearly always aimed at a
/// recent message, and a hit on the last page means the older pages are never
/// read at all.
pub(super) fn locate(pages: &[Vec<GroupMessage>], message_id: &str) -> Option<(usize, usize)> {
    for (page_index, page) in pages.iter().enumerate().rev() {
        if let Some(offset) = page.iter().position(|m| m.id == message_id) {
            return Some((page_index, offset));
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use citadel_workspace_types::GroupMessageType;

    fn message(id: &str) -> GroupMessage {
        GroupMessage {
            id: id.to_string(),
            group_id: "g".to_string(),
            sender_id: "s".to_string(),
            content: String::new(),
            message_type: GroupMessageType::Text,
            timestamp: 0,
            edited_at: None,
            reply_to: None,
            reply_count: 0,
            sender_name: String::new(),
            mentions: vec![],
        }
    }

    fn messages(n: usize) -> Vec<GroupMessage> {
        (0..n).map(|i| message(&format!("m{i}"))).collect()
    }

    #[test]
    fn splitting_preserves_every_message_and_its_order() {
        let original = messages(PAGE_SIZE * 2 + 7);
        let pages = split_into_pages(original.clone());

        assert_eq!(pages.len(), 3);
        let flattened: Vec<String> = pages.iter().flatten().map(|m| m.id.clone()).collect();
        let expected: Vec<String> = original.iter().map(|m| m.id.clone()).collect();
        assert_eq!(
            flattened, expected,
            "the migration reordered or lost messages",
        );
    }

    #[test]
    fn an_empty_room_still_gets_one_page() {
        // Otherwise the index is absent, the room reads as unmigrated, and every
        // subsequent write re-runs the migration.
        assert_eq!(split_into_pages(vec![]).len(), 1);
    }

    #[test]
    fn an_append_fills_the_last_page_before_starting_another() {
        assert_eq!(
            append_target(0, 0),
            AppendTarget {
                page: 0,
                starts_a_page: true
            },
        );
        assert_eq!(
            append_target(1, 1),
            AppendTarget {
                page: 0,
                starts_a_page: false
            },
        );
        assert_eq!(
            append_target(1, PAGE_SIZE - 1),
            AppendTarget {
                page: 0,
                starts_a_page: false
            },
        );
        // Full: the next message starts page 1.
        assert_eq!(
            append_target(1, PAGE_SIZE),
            AppendTarget {
                page: 1,
                starts_a_page: true
            },
        );
        assert_eq!(
            append_target(3, PAGE_SIZE),
            AppendTarget {
                page: 3,
                starts_a_page: true
            },
        );
    }

    #[test]
    fn a_split_page_is_exactly_full_so_the_next_append_rolls_over() {
        // The two halves have to agree: if split_into_pages made pages of
        // PAGE_SIZE and append_target rolled over at a different number, the
        // first message after a migration would land in an over-full page or
        // start a new one early. Asserted against each other rather than against
        // a literal.
        let pages = split_into_pages(messages(PAGE_SIZE));
        assert_eq!(pages.len(), 1);
        assert_eq!(
            append_target(pages.len(), pages[0].len()),
            AppendTarget {
                page: 1,
                starts_a_page: true
            },
        );
    }

    #[test]
    fn locate_finds_a_message_on_any_page() {
        let pages = split_into_pages(messages(PAGE_SIZE + 3));
        assert_eq!(locate(&pages, "m0"), Some((0, 0)));
        assert_eq!(locate(&pages, &format!("m{}", PAGE_SIZE)), Some((1, 0)));
        assert_eq!(locate(&pages, &format!("m{}", PAGE_SIZE + 2)), Some((1, 2)));
        assert_eq!(locate(&pages, "absent"), None);
    }

    #[test]
    fn locate_searches_the_newest_page_first() {
        // Not an optimisation detail: if two pages somehow carried the same id,
        // the newest is the one an edit or delete means. Stated here so a change
        // to the direction has to argue with a test.
        let pages = vec![vec![message("dup")], vec![message("dup")]];
        assert_eq!(locate(&pages, "dup"), Some((1, 0)));
    }
}
