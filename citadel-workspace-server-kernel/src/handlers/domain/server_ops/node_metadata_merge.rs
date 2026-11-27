//! Changing a node's metadata after it exists, and the tab keys of the workspace's.
//!
//! A node's metadata was write-once: `CreateNode` stored it and nothing could change it, so a
//! per-node setting (its app tabs, its time zone) had nowhere to go. `UpdateNode.metadata` is
//! merged here the way a workspace metadata write is (`merge_metadata_document`): top-level keys
//! the patch names replace the stored ones, every other key is kept. Unlike the workspace path,
//! the keys this server gives meaning to are checked (`node_tabs`):
//!
//! - `app_tabs` must be a list of at most eight distinct app ids, or `null` to remove it, after
//!   which the node follows the workspace default again;
//! - `time_zone` must be a known IANA name, or `null` to remove the override;
//! - `citadel_app`, the app a document node opens in, is the node's identity and may not change.
//!
//! Any other key is kept as sent, as the workspace path keeps it. The result stays within the
//! creation cap, because the document is broadcast with the node to every member.

use super::metadata_merge::merge_metadata_document;
use super::node_metadata::MAX_NODE_METADATA_BYTES;
use citadel_workspace_types::node_tabs::{
    check_app_tabs, check_time_zone, APP_TABS_KEY, CITADEL_APP_KEY, DEFAULT_APP_TABS_KEY,
    PROVISIONED_DEFAULT_APP_TABS, TIME_ZONE_KEY,
};
use serde_json::{Map, Value};

fn object_of(bytes: &[u8]) -> Option<Map<String, Value>> {
    match serde_json::from_slice::<Value>(bytes) {
        Ok(Value::Object(map)) => Some(map),
        _ => None,
    }
}

fn bounded(bytes: Vec<u8>) -> Result<Vec<u8>, String> {
    if bytes.len() > MAX_NODE_METADATA_BYTES {
        return Err(format!(
            "Node metadata would be {} bytes; the limit is {}",
            bytes.len(),
            MAX_NODE_METADATA_BYTES
        ));
    }
    Ok(bytes)
}

/// The node's metadata once `incoming` is merged into `existing`, or why the patch is refused.
pub fn merge_node_metadata(existing: &[u8], incoming: &[u8]) -> Result<Vec<u8>, String> {
    if incoming.len() > MAX_NODE_METADATA_BYTES {
        return Err(format!(
            "Node metadata is {} bytes; the limit is {}",
            incoming.len(),
            MAX_NODE_METADATA_BYTES
        ));
    }
    let patch = object_of(incoming).ok_or("Node metadata must be a JSON object")?;
    let stored = object_of(existing).unwrap_or_default();

    let mut removed = Vec::new();
    let mut kept = Map::new();
    for (key, value) in patch {
        match key.as_str() {
            APP_TABS_KEY | TIME_ZONE_KEY if value.is_null() => removed.push(key),
            APP_TABS_KEY => {
                check_app_tabs(&value).map_err(|why| why.to_string())?;
                kept.insert(key, value);
            }
            TIME_ZONE_KEY => {
                check_time_zone(&value).map_err(|why| why.to_string())?;
                kept.insert(key, value);
            }
            CITADEL_APP_KEY if stored.get(CITADEL_APP_KEY) != Some(&value) => {
                return Err(
                    "A node's Citadel App is set when it is created and never changed".into(),
                )
            }
            _ => {
                kept.insert(key, value);
            }
        }
    }

    let patch_bytes = serde_json::to_vec(&Value::Object(kept))
        .map_err(|e| format!("Failed to encode metadata: {e}"))?;
    let merged = merge_metadata_document(existing, &patch_bytes)?;
    if removed.is_empty() {
        return bounded(merged);
    }
    let mut document = object_of(&merged).ok_or("The merged metadata is not an object")?;
    for key in removed {
        document.remove(&key);
    }
    bounded(
        serde_json::to_vec(&Value::Object(document))
            .map_err(|e| format!("Failed to encode metadata: {e}"))?,
    )
}

/// Whether a workspace metadata patch may be merged: the tab and zone keys it names are checked.
/// `default_app_tabs` may not be removed (an empty list says "no default tabs"), because a
/// workspace without the key is one that has never been provisioned with them.
pub fn check_workspace_metadata_patch(incoming: &[u8]) -> Result<(), String> {
    let Some(patch) = object_of(incoming) else {
        return Ok(());
    };
    if let Some(value) = patch.get(DEFAULT_APP_TABS_KEY) {
        check_app_tabs(value).map_err(|why| why.to_string())?;
    }
    if let Some(value) = patch.get(TIME_ZONE_KEY) {
        check_time_zone(value).map_err(|why| why.to_string())?;
    }
    Ok(())
}

/// The workspace metadata with `default_app_tabs` set to `app_tabs`, every other key kept.
pub fn with_default_app_tabs(existing: &[u8], app_tabs: &[String]) -> Result<Vec<u8>, String> {
    let value = Value::from(app_tabs.to_vec());
    check_app_tabs(&value).map_err(|why| why.to_string())?;
    let mut patch = Map::new();
    patch.insert(DEFAULT_APP_TABS_KEY.to_string(), value);
    let bytes = serde_json::to_vec(&Value::Object(patch))
        .map_err(|e| format!("Failed to encode metadata: {e}"))?;
    merge_metadata_document(existing, &bytes)
}

/// The workspace metadata with the home's own `app_tabs` set to `value`, or removed when it is
/// `null` (the home then follows `default_app_tabs`, as a node without a list does). The home is
/// the workspace root, which has no node record: the workspace record is the root's, so its own
/// tabs sit beside the default there, under the key a node uses.
pub fn with_home_app_tabs(existing: &[u8], value: &Value) -> Result<Vec<u8>, String> {
    let mut document = object_of(existing).unwrap_or_default();
    if value.is_null() {
        document.remove(APP_TABS_KEY);
    } else {
        check_app_tabs(value).map_err(|why| why.to_string())?;
        document.insert(APP_TABS_KEY.to_string(), value.clone());
    }
    serde_json::to_vec(&Value::Object(document))
        .map_err(|e| format!("Failed to encode metadata: {e}"))
}

/// The metadata a workspace without `default_app_tabs` is provisioned with, or `None` when it
/// already has the key, whatever list it holds: an administrator's choice, `[]` included, is
/// never overwritten.
pub fn provisioned_default_app_tabs(existing: &[u8]) -> Result<Option<Vec<u8>>, String> {
    if object_of(existing).is_some_and(|map| map.contains_key(DEFAULT_APP_TABS_KEY)) {
        return Ok(None);
    }
    let tabs: Vec<String> = PROVISIONED_DEFAULT_APP_TABS
        .iter()
        .map(|id| id.to_string())
        .collect();
    with_default_app_tabs(existing, &tabs).map(Some)
}
