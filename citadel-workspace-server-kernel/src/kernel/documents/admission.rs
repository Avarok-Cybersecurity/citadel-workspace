//! What an append may write. Pure: given the log's head and the clocks the update writes, the
//! head after it, or why it is refused.
//!
//! A CRDT client id is bound, on this document, to the author that first wrote as it, and no
//! other author may write as it after: otherwise anyone who may edit could write operations that
//! every replica attributes to someone else, or overwrite their marks and attributes. The blank
//! document's client writes the base every replica shares, so no one writes as it.

use super::crdt::{Clocks, RESERVED_CLIENT};
use super::log::LogHead;
use super::DocumentsConfig;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum AppendRefused {
    Reserved,
    Foreign { crdt_client: u64 },
    TooManyClients { max_clients: u32 },
    LogFull { pending_bytes: u64, max_bytes: u64 },
}

/// The head once `author_cid`'s update of `size_bytes`, writing `writes`, is the next in the log.
pub(crate) fn admit(
    head: &LogHead,
    writes: &Clocks,
    author_cid: u64,
    size_bytes: u64,
    config: &DocumentsConfig,
) -> Result<LogHead, AppendRefused> {
    let mut authors = head.authors.clone();
    for &client in writes.keys() {
        if client == RESERVED_CLIENT {
            return Err(AppendRefused::Reserved);
        }
        match authors.get(&client) {
            Some(&bound) if bound != author_cid => {
                return Err(AppendRefused::Foreign {
                    crdt_client: client,
                })
            }
            Some(_) => {}
            None => {
                authors.insert(client, author_cid);
            }
        }
    }
    if authors.len() > config.max_clients_per_document as usize {
        return Err(AppendRefused::TooManyClients {
            max_clients: config.max_clients_per_document,
        });
    }
    let pending_bytes = head
        .pending_bytes
        .checked_add(size_bytes)
        .filter(|pending| *pending <= config.max_pending_log_bytes)
        .ok_or(AppendRefused::LogFull {
            pending_bytes: head.pending_bytes,
            max_bytes: config.max_pending_log_bytes,
        })?;
    Ok(LogHead {
        latest_seq: head.latest_seq + 1,
        pending_bytes,
        authors,
        ..head.clone()
    })
}
