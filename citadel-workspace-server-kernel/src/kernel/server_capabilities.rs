//! What the server tells clients it can do, derived from what it actually runs on.
//!
//! The SDK decides at connect time whether a session can carry streamed objects
//! (`BackendType::stores_streamed_objects`), and refuses every transfer to a node whose backend
//! cannot: "File transfer is not enabled for this session. Both nodes must use a filesystem
//! backend". Advertising server file transfer or RE-VFS storage from the configuration alone
//! told clients a server on the in-memory (or SQL) backend could take files, and sent every
//! upload into that refusal.

use citadel_sdk::prelude::BackendType;
use citadel_workspace_types::server_feature_refusal::ServerFeatureRefusal;

/// Why a server feature that streams objects to the server (server file transfer, RE-VFS
/// storage) is unavailable, or `None` when it is available: the configuration allows it AND the
/// backend the node runs on stores streamed objects. A kernel with no node has no backend.
pub fn streamed_objects_refusal(
    configured: bool,
    backend: Option<&BackendType>,
) -> Option<ServerFeatureRefusal> {
    if !configured {
        return Some(ServerFeatureRefusal::DisabledByConfig);
    }
    match backend {
        None => Some(ServerFeatureRefusal::NoBackend),
        Some(backend) if backend.stores_streamed_objects() => None,
        Some(backend) => Some(ServerFeatureRefusal::BackendCannotStoreStreamedObjects {
            backend: backend_kind(backend),
        }),
    }
}

/// The backend's variant name and nothing else. Its fields are a filesystem path or a database
/// URL, which can carry credentials; the name is cut at the first field.
fn backend_kind(backend: &BackendType) -> String {
    let debug = format!("{backend:?}");
    let end = debug.find(['(', ' ', '{']).unwrap_or(debug.len());
    debug[..end].to_string()
}

#[cfg(test)]
mod tests {
    use super::streamed_objects_refusal;
    use citadel_sdk::prelude::BackendType;
    use citadel_workspace_types::server_feature_refusal::ServerFeatureRefusal;

    fn filesystem() -> BackendType {
        BackendType::Filesystem("/var/lib/workspace-server".to_string())
    }

    fn cannot_store(backend: &str) -> Option<ServerFeatureRefusal> {
        Some(ServerFeatureRefusal::BackendCannotStoreStreamedObjects {
            backend: backend.to_string(),
        })
    }

    #[test]
    fn an_in_memory_backend_cannot_take_files() {
        let refusal = streamed_objects_refusal(true, Some(&BackendType::InMemory));
        assert_eq!(refusal, cannot_store("InMemory"));
    }

    #[test]
    fn a_filesystem_backend_can_take_files() {
        assert_eq!(streamed_objects_refusal(true, Some(&filesystem())), None);
    }

    #[test]
    fn configuration_can_still_turn_the_feature_off() {
        let refusal = streamed_objects_refusal(false, Some(&filesystem()));
        assert_eq!(refusal, Some(ServerFeatureRefusal::DisabledByConfig));
    }

    #[test]
    fn a_kernel_without_a_node_offers_no_file_features() {
        assert_eq!(
            streamed_objects_refusal(true, None),
            Some(ServerFeatureRefusal::NoBackend)
        );
    }

    #[test]
    fn a_sql_backend_is_named_without_its_url() {
        let url = "postgres://admin:hunter2@db.internal/workspace";
        let refusal = streamed_objects_refusal(true, Some(&BackendType::sql(url)));
        assert_eq!(refusal, cannot_store("SQLDatabase"));
    }
}
