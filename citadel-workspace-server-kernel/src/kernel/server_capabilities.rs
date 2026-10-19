//! What the server tells clients it can do, derived from what it actually runs on.
//!
//! The SDK decides at connect time whether a session can carry streamed objects
//! (`BackendType::stores_streamed_objects`), and refuses every transfer to a node whose backend
//! cannot: "File transfer is not enabled for this session. Both nodes must use a filesystem
//! backend". Advertising server file transfer or RE-VFS storage from the configuration alone
//! told clients a server on the in-memory (or SQL) backend could take files, and sent every
//! upload into that refusal.

use citadel_sdk::prelude::BackendType;

/// A server feature that streams objects to the server (server file transfer, RE-VFS storage)
/// is available only when the configuration allows it AND the backend the node runs on stores
/// streamed objects. A kernel with no node yet has no backend to store into.
pub fn streamed_objects_available(configured: bool, backend: Option<&BackendType>) -> bool {
    configured && backend.is_some_and(BackendType::stores_streamed_objects)
}

#[cfg(test)]
mod tests {
    use super::streamed_objects_available;
    use citadel_sdk::prelude::BackendType;

    fn filesystem() -> BackendType {
        BackendType::Filesystem("/var/lib/workspace-server".to_string())
    }

    #[test]
    fn an_in_memory_backend_cannot_take_files() {
        assert!(!streamed_objects_available(
            true,
            Some(&BackendType::InMemory)
        ));
    }

    #[test]
    fn a_filesystem_backend_can_take_files() {
        assert!(streamed_objects_available(true, Some(&filesystem())));
    }

    #[test]
    fn configuration_can_still_turn_the_feature_off() {
        assert!(!streamed_objects_available(false, Some(&filesystem())));
    }

    #[test]
    fn a_kernel_without_a_node_offers_no_file_features() {
        assert!(!streamed_objects_available(true, None));
    }
}
