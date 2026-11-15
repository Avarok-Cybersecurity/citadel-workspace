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
//! - an upload nobody shares within `UNSHARED_GRACE_MS` is dropped by the node's next upload, so
//!   an abandoned upload does not hold the workspace's storage for ever.

use crate::kernel::apps::storage::StorageRoot;
use citadel_workspace_types::chat_attachments::ChatAttachmentRefusal;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

/// The app id of every node's chat-file root. Not a valid app id (`citadel_app_id`: dot-separated
/// lowercase labels), so no app's root can be one of these.
pub const CHAT_ATTACHMENTS_ROOT: &str = "sys/chat-attachments";

/// The most files one node keeps, so its index stays one record a Durable Object admits.
pub const MAX_FILES_PER_NODE: u32 = 2048;

/// How long an upload stays when no message shares it.
pub const UNSHARED_GRACE_MS: u64 = 60 * 60 * 1000;

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
    ) -> Result<(), ChatAttachmentRefusal> {
        if !self.files.contains_key(id) && self.files.len() >= MAX_FILES_PER_NODE as usize {
            return Err(ChatAttachmentRefusal::NodeFull {
                max_files: MAX_FILES_PER_NODE,
            });
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
}
