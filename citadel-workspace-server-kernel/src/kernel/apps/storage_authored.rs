//! `storage.node.authored` (Calendar design §3.3.1), pure: one KV per (app, scope, node,
//! author), so anyone who may view a node can post on it (an event, an RSVP, a booking) without
//! the node's `EditMdx`.
//!
//! - **Authorship is the session's.** A write lands in the caller's own namespace; a write that
//!   names any other author is refused, so no one can write under another's name. A read may name
//!   any author, or none for the caller's own.
//! - **Listing across authors.** Each node keeps a roster of the authors holding anything there,
//!   saved with every write that empties or first fills an author's namespace, so a page of every
//!   author's keys is read without scanning the workspace's members. A page runs by author, then
//!   key; its cursor is `<author>\n<key>` (keys hold no control characters, so the last newline
//!   splits it).
//! - **Quota.** `NODE_AUTHORED_KV_QUOTA` bytes and `KV_MAX_KEYS` keys per namespace.

use super::storage::{KvIndex, Namespace, StorageRefusal, KV_LIST_PAGE};
use super::storage_write::app_visible;
use citadel_app_sdk_types::calls::{AuthoredKey, AuthoredPage};

/// Bytes one author may hold on one node, per app and scope (owner decision 5's 2048 keys come
/// from `KV_MAX_KEYS`).
pub const NODE_AUTHORED_KV_QUOTA: u64 = 256 * 1024;

/// Whether an op reads a namespace or writes to it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Access {
    Read,
    Write,
}

/// The authored namespace an op on `node` addresses for `caller`; `named` is the author the call
/// named, None for the caller's own.
pub fn authored_namespace(
    node: &str,
    named: Option<&str>,
    caller: &str,
    access: Access,
) -> Result<Namespace, StorageRefusal> {
    let author = match (access, named) {
        (Access::Write, Some(other)) if other != caller => {
            return Err(StorageRefusal::Policy("author"))
        }
        (_, Some(author)) => author,
        (_, None) => caller,
    };
    if author.is_empty() || author.chars().any(char::is_control) {
        return Err(StorageRefusal::Policy("bad_author"));
    }
    Ok(Namespace::NodeAuthored {
        node: node.to_string(),
        author: author.to_string(),
    })
}

/// The node's roster after `author`'s namespace became `next`: an author is listed exactly while
/// they hold a key there. None when the roster does not change.
pub fn roster_after(roster: &KvIndex, author: &str, next: &KvIndex) -> Option<KvIndex> {
    let listed = roster.keys.contains_key(author);
    let holds = !next.keys.is_empty();
    if listed == holds {
        return None;
    }
    let mut changed = roster.clone();
    if holds {
        changed.keys.insert(author.to_string(), 0);
    } else {
        changed.keys.remove(author);
    }
    Some(changed)
}

/// A cross-author cursor, as `KvListAuthored` hands it out.
pub fn encode_cursor(author: &str, key: &str) -> String {
    format!("{author}\n{key}")
}

/// `(author, key)` of a cursor `encode_cursor` made.
pub fn decode_cursor(cursor: &str) -> Result<(&str, &str), StorageRefusal> {
    match cursor.rsplit_once('\n') {
        Some((author, key)) if !author.is_empty() && !key.is_empty() => Ok((author, key)),
        _ => Err(StorageRefusal::Policy("bad_cursor")),
    }
}

/// The authors a page starting at `cursor` reads, in order: the cursor's own and every one after.
pub fn authors_from<'a>(roster: &'a KvIndex, cursor: Option<(&str, &str)>) -> Vec<&'a str> {
    let start = cursor.map(|(author, _)| author);
    roster
        .keys
        .keys()
        .map(String::as_str)
        .filter(|author| start.is_none_or(|first| *author >= first))
        .collect()
}

/// One page of every author's keys under `prefix`, filled one author's index at a time.
pub struct AuthoredPager<'a> {
    prefix: &'a str,
    cursor: Option<(&'a str, &'a str)>,
    entries: Vec<AuthoredKey>,
}

impl<'a> AuthoredPager<'a> {
    pub fn new(prefix: &'a str, cursor: Option<(&'a str, &'a str)>) -> Self {
        Self {
            prefix,
            cursor,
            entries: Vec::new(),
        }
    }

    /// Take `author`'s matching keys; true once the page is full and one more entry proves a
    /// next page, so no further index need be read.
    pub fn take(&mut self, author: &str, index: &KvIndex) -> bool {
        let after = match self.cursor {
            Some((first, key)) if first == author => Some(key),
            _ => None,
        };
        let matching = index
            .keys
            .keys()
            .filter(|key| key.starts_with(self.prefix) && app_visible(key))
            .filter(|key| after.is_none_or(|a| key.as_str() > a));
        for key in matching {
            self.entries.push(AuthoredKey {
                author: author.to_string(),
                key: key.clone(),
            });
            if self.entries.len() > KV_LIST_PAGE {
                return true;
            }
        }
        false
    }

    pub fn finish(mut self) -> AuthoredPage {
        let more = self.entries.len() > KV_LIST_PAGE;
        self.entries.truncate(KV_LIST_PAGE);
        let next = more
            .then(|| self.entries.last())
            .flatten()
            .map(|last| encode_cursor(&last.author, &last.key));
        AuthoredPage {
            entries: self.entries,
            next,
        }
    }
}
