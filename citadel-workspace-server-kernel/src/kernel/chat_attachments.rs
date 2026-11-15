//! Files shared in a node's chat (`citadel_workspace_types::chat_attachments`), as the kernel
//! keeps them. Pure: where a node's files are stored, who may read each, and what a share or a
//! delete does to them.
//!
//! A node's files are app-storage blobs under one storage root of their own (`root_of`), so they
//! are chunked, counted toward the workspace's storage, and purged, by the code app blobs are. No
//! app can own that root: its app id is not one an app may have. Beside the blobs, an index says
//! for each file who uploaded it and which messages share it:
//! - an upload is readable by its uploaders until a message shares it, then by the channel;
//! - a share is stored only by someone who uploaded that file at that node, at its size;
//! - deleting the last message that shares a file deletes the file;
//! - an upload nobody shares within `UNSHARED_GRACE_MS` is dropped by the node's next upload or
//!   by the periodic sweep (`chat_attachment_sweep`), whichever comes first, so an abandoned
//!   upload does not hold the workspace's storage for ever.

use crate::kernel::apps::storage::StorageRoot;
use citadel_workspace_types::chat_attachments::ChatAttachmentRefusal;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

/// The app id of every node's chat-file root. Not a valid app id (`citadel_app_id`: dot-separated
/// lowercase labels), so no app's root can be one of these.
pub const CHAT_ATTACHMENTS_ROOT: &str = "sys/chat-attachments";

/// How long an upload stays when no message shares it. Not configuration: it is the window
/// between the client's last chunk and its `FileShare` message (one round trip, then the send),
/// widened to cover a member who uploads, loses the connection, and sends once reconnected. It
/// bounds only how long abandoned bytes are held, which they already count toward the
/// workspace's storage, so no operator has a reason to tune it.
pub const UNSHARED_GRACE_MS: u64 = 60 * 60 * 1000;

/// What a server lets a node's chat keep, read from `kernel.toml` with no default
/// (`resolve_chat_attachment_limits`): a default would be a limit nobody chose.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ChatAttachmentLimits {
    /// The largest file, in bytes; 0 keeps none.
    pub max_bytes: u64,
    /// The most files one node keeps. Its index is one record read and written whole under
    /// `APPS_LOCK` (and one Durable Object value, at most 2 MB), so this bounds both that
    /// record's size and the work each upload and sweep does on it.
    pub max_files_per_node: u32,
}

/// Where every member's chat upload in progress is counted (`UploadSlot::ChatAttachment`): one
/// namespace per member, holding the size of the file they are uploading, so a staged upload
/// counts toward the workspace's storage from its first chunk until it is kept or dropped.
pub fn staging_root() -> StorageRoot {
    StorageRoot {
        app_id: CHAT_ATTACHMENTS_ROOT.to_string(),
        scope_key: "staging".to_string(),
    }
}

/// Where `node_id`'s chat files are stored.
pub fn root_of(node_id: &str) -> StorageRoot {
    StorageRoot {
        app_id: CHAT_ATTACHMENTS_ROOT.to_string(),
        scope_key: format!("node:{node_id}"),
    }
}

/// One file a node keeps.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct AttachmentEntry {
    pub size_bytes: u64,
    /// Who uploaded these bytes here.
    pub uploaders: BTreeSet<String>,
    /// The ids of the messages that share it.
    pub messages: BTreeSet<String>,
    /// When it was last uploaded, in ms since the epoch.
    pub uploaded_at_ms: u64,
}

/// A node's files, by id (the SHA-256 of their bytes).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct AttachmentIndex {
    pub files: BTreeMap<String, AttachmentEntry>,
}

impl AttachmentIndex {
    /// The file `id` if `user` may read it: one a message shares, or one they uploaded.
    pub fn readable_by(&self, id: &str, user: &str) -> Option<&AttachmentEntry> {
        self.files
            .get(id)
            .filter(|entry| !entry.messages.is_empty() || entry.uploaders.contains(user))
    }

    /// The files nobody shared within the grace period at `now_ms`, with their sizes.
    pub fn stale(&self, now_ms: u64) -> Vec<(String, u64)> {
        self.files
            .iter()
            .filter(|(_, entry)| {
                entry.messages.is_empty()
                    && now_ms.saturating_sub(entry.uploaded_at_ms) > UNSHARED_GRACE_MS
            })
            .map(|(id, entry)| (id.clone(), entry.size_bytes))
            .collect()
    }

    /// Records that `user` uploaded `id` of `size_bytes` at `now_ms`.
    pub fn record_upload(
        &mut self,
        id: &str,
        size_bytes: u64,
        user: &str,
        now_ms: u64,
        max_files: u32,
    ) -> Result<(), ChatAttachmentRefusal> {
        if !self.files.contains_key(id) && self.files.len() >= max_files as usize {
            return Err(ChatAttachmentRefusal::NodeFull { max_files });
        }
        let entry = self.files.entry(id.to_string()).or_default();
        entry.size_bytes = size_bytes;
        entry.uploaders.insert(user.to_string());
        entry.uploaded_at_ms = now_ms;
        Ok(())
    }

    /// Records that `message_id` shares `id`, when `sender` uploaded it here at `size_bytes`.
    /// `false` (nothing recorded) for any other share.
    pub fn claim(&mut self, id: &str, size_bytes: u64, sender: &str, message_id: &str) -> bool {
        match self.files.get_mut(id) {
            Some(entry) if entry.uploaders.contains(sender) && entry.size_bytes == size_bytes => {
                entry.messages.insert(message_id.to_string())
            }
            _ => false,
        }
    }

    /// Forgets that `message_id` shares `id`. The file's size when that was its last share, which
    /// drops it; the caller then deletes its bytes.
    pub fn release(&mut self, id: &str, message_id: &str) -> Option<u64> {
        let entry = self.files.get_mut(id)?;
        if !entry.messages.remove(message_id) || !entry.messages.is_empty() {
            return None;
        }
        self.files.remove(id).map(|entry| entry.size_bytes)
    }

    /// Takes back `message_id`'s share of `id` when that message was not stored after all. Unlike
    /// `release`, the file stays: it is still its uploader's, as it was before the share.
    pub fn unclaim(&mut self, id: &str, message_id: &str) {
        if let Some(entry) = self.files.get_mut(id) {
            entry.messages.remove(message_id);
        }
    }

    /// What a sweep at `now_ms` does, given the node's ledger (`blobs`: id to size): drop the
    /// bytes of stale uploads and of files the index never came to name (a store stopped between
    /// the ledger and the index), and forget stale entries and entries whose bytes the ledger
    /// does not hold (a delete stopped between the bytes and the index).
    pub fn sweep(&self, ledger: &BTreeMap<String, u64>, now_ms: u64) -> SweepPlan {
        let stale = self.stale(now_ms);
        let mut drop: Vec<(String, u64)> = ledger
            .iter()
            .filter(|(id, _)| !self.files.contains_key(*id))
            .map(|(id, size)| (id.clone(), *size))
            .collect();
        drop.extend(
            stale
                .iter()
                .filter_map(|(id, _)| ledger.get(id).map(|size| (id.clone(), *size))),
        );
        drop.sort();
        let mut forget: Vec<String> = self
            .files
            .keys()
            .filter(|id| !ledger.contains_key(*id))
            .cloned()
            .collect();
        forget.extend(stale.into_iter().map(|(id, _)| id));
        forget.sort();
        forget.dedup();
        SweepPlan { drop, forget }
    }
}

/// What one node's sweep removes (`AttachmentIndex::sweep`).
#[derive(Debug, Default, PartialEq, Eq)]
pub struct SweepPlan {
    /// Bytes to delete, with the ledger's size for each.
    pub drop: Vec<(String, u64)>,
    /// Index entries to remove.
    pub forget: Vec<String>,
}

impl SweepPlan {
    pub fn is_empty(&self) -> bool {
        self.drop.is_empty() && self.forget.is_empty()
    }
}
