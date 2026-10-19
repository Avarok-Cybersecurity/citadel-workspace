//! What the server tells clients it can do, derived from what it actually runs on.
//!
//! The SDK decides at connect time whether a session can carry streamed objects
//! (`BackendType::stores_streamed_objects`), and refuses every upload to a node whose backend
//! cannot: "File transfer is not enabled for this session. Both nodes must use a filesystem
//! backend". Advertising RE-VFS storage from the configuration alone told clients a server on
//! the in-memory (or SQL) backend could store files, and sent every upload into that refusal.

use citadel_sdk::prelude::BackendType;

/// RE-VFS storage is available only when the configuration allows it AND the backend the node
/// runs on stores streamed objects. A kernel with no node yet has no backend to store into.
pub fn revfs_storage_available(configured: bool, backend: Option<&BackendType>) -> bool {
    configured && backend.is_some_and(BackendType::stores_streamed_objects)
}

#[cfg(test)]
mod tests {
    use super::revfs_storage_available;
    use citadel_sdk::prelude::BackendType;

    #[test]
    fn an_in_memory_backend_cannot_store_files() {
        assert!(!revfs_storage_available(true, Some(&BackendType::InMemory)));
    }

    #[test]
    fn a_filesystem_backend_can_store_files() {
        let backend = BackendType::Filesystem("/var/lib/workspace-server".to_string());
        assert!(revfs_storage_available(true, Some(&backend)));
    }

    #[test]
    fn configuration_can_still_turn_storage_off() {
        let backend = BackendType::Filesystem("/var/lib/workspace-server".to_string());
        assert!(!revfs_storage_available(false, Some(&backend)));
    }

    #[test]
    fn a_kernel_without_a_node_advertises_no_storage() {
        assert!(!revfs_storage_available(true, None));
    }
}
