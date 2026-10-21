//! Why the server does not offer a file feature (server file transfer, RE-VFS storage).

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Why `ServerCapabilities` reports a file feature as unavailable, so a client can say so
/// rather than invent a sentence. Sent beside the feature's flag only when the flag is false;
/// an absent reason means none was given (a server older than this field).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum ServerFeatureRefusal {
    /// The server's `[file_transfer]` configuration turns the feature off.
    DisabledByConfig,
    /// The server has no storage backend running yet.
    NoBackend,
    /// The backend the server runs on does not store the objects streamed to it, and the
    /// transport refuses every transfer to such a node. `backend` is the backend's kind
    /// (`InMemory`, `SQLDatabase`, ...), never its location or credentials.
    BackendCannotStoreStreamedObjects { backend: String },
}
