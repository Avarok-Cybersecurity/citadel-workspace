//! The metadata document a node is created with.
//!
//! A node's `metadata` follows the workspace's convention: one JSON object whose
//! top-level keys belong to independent features (the Citadel App a document
//! node opens in is the first). `CreateNode` carried no such field, so the bytes
//! the client sent were dropped by serde and every node was stored with empty
//! metadata.
//!
//! The document is checked the way a workspace metadata write is, through
//! `merge_metadata_document`, so a node can never hold something a later merge
//! would refuse to build on. It is bounded too: it is broadcast with the node to
//! every member and persisted with the tree.

use super::metadata_merge::merge_metadata_document;

/// The most bytes a node's metadata document may hold.
pub const MAX_NODE_METADATA_BYTES: usize = 4096;

/// The metadata to store on a new node: empty when none was sent, otherwise the
/// sent document once it is known to be a bounded JSON object.
pub fn new_node_metadata(incoming: Option<&[u8]>) -> Result<Vec<u8>, String> {
    let Some(bytes) = incoming else {
        return Ok(Vec::new());
    };
    if bytes.len() > MAX_NODE_METADATA_BYTES {
        return Err(format!(
            "Node metadata is {} bytes; the limit is {}",
            bytes.len(),
            MAX_NODE_METADATA_BYTES
        ));
    }
    merge_metadata_document(&[], bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    #[test]
    fn no_metadata_is_stored_as_empty() {
        assert_eq!(new_node_metadata(None).unwrap(), Vec::<u8>::new());
    }

    #[test]
    fn a_json_object_is_kept_key_for_key() {
        let stored = new_node_metadata(Some(
            br#"{"citadel_app":{"v":1,"kind":"citadel-app","payload":{"app":"docs"}}}"#,
        ))
        .unwrap();
        let value: Value = serde_json::from_slice(&stored).unwrap();
        assert_eq!(value["citadel_app"]["payload"]["app"], "docs");
    }

    #[test]
    fn anything_but_a_json_object_is_refused() {
        assert!(new_node_metadata(Some(b"not json")).is_err());
        assert!(new_node_metadata(Some(br#"[1,2]"#)).is_err());
        assert!(new_node_metadata(Some(br#""docs""#)).is_err());
    }

    #[test]
    fn an_oversized_document_is_refused() {
        let padding = "x".repeat(MAX_NODE_METADATA_BYTES);
        let big = format!(r#"{{"pad":"{padding}"}}"#);
        assert!(new_node_metadata(Some(big.as_bytes())).is_err());
    }
}
