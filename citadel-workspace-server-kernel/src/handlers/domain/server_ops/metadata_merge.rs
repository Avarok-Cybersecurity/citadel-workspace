//! Merging into the shared workspace metadata document.
//!
//! `Workspace::metadata` is a single JSON object that several independent
//! features share: initialisation writes `{"initialized": true}`, theming writes
//! a `theme` envelope, and anything added later will want its own key. Every
//! writer therefore has to merge rather than assign.
//!
//! This exists as one function because the rule was previously implemented in
//! the theme handler alone, and `update_workspace` — the very path that writes
//! the initialisation marker — kept assigning over the top. A shared helper is
//! what stops a third writer repeating it.

use serde_json::Value;

/// Merge `incoming`'s top-level keys into `existing`, returning the new document.
///
/// Both sides are tolerated when unparseable, because refusing the write is the
/// worse outcome: a workspace whose metadata was corrupted by some earlier
/// version would become permanently unconfigurable. A non-object on either side
/// simply contributes no keys to keep.
///
/// Returns `Err` only when the merged document cannot be re-encoded, which the
/// caller should surface rather than silently write nothing.
pub fn merge_metadata_document(existing: &[u8], incoming: &[u8]) -> Result<Vec<u8>, String> {
    let mut root = match serde_json::from_slice::<Value>(existing) {
        Ok(value) if value.is_object() => value,
        // Absent, corrupt, or not an object: there are no sibling keys worth
        // preserving, so starting fresh is the only well-formed option.
        _ => Value::Object(Default::default()),
    };

    let patch = match serde_json::from_slice::<Value>(incoming) {
        Ok(value) => value,
        Err(e) => return Err(format!("Metadata payload is not valid JSON: {e}")),
    };

    match patch {
        Value::Object(map) => {
            let root_map = root
                .as_object_mut()
                .expect("root was replaced with an object above when not one");
            for (key, value) in map {
                root_map.insert(key, value);
            }
        }
        // A non-object payload has no keys to merge. Replacing the shared
        // document with it would erase every other feature's state, so the
        // document is left as it stands.
        _ => return Err("Metadata payload must be a JSON object".to_string()),
    }

    serde_json::to_vec(&root).map_err(|e| format!("Failed to encode metadata: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn json(bytes: &[u8]) -> Value {
        serde_json::from_slice(bytes).expect("merged document must be valid JSON")
    }

    #[test]
    fn keeps_a_sibling_key_the_writer_never_mentioned() {
        // The exact regression: initialisation writing {"initialized":true} used
        // to erase a theme that had already been saved.
        let existing = br#"{"theme":{"v":1,"theme":{"primary":"blue"}}}"#;
        let merged = merge_metadata_document(existing, br#"{"initialized":true}"#).unwrap();

        let value = json(&merged);
        assert_eq!(value["initialized"], Value::Bool(true));
        assert_eq!(value["theme"]["theme"]["primary"], "blue");
    }

    #[test]
    fn incoming_wins_for_a_key_present_on_both_sides() {
        let merged =
            merge_metadata_document(br#"{"initialized":false}"#, br#"{"initialized":true}"#)
                .unwrap();
        assert_eq!(json(&merged)["initialized"], Value::Bool(true));
    }

    #[test]
    fn starts_fresh_when_the_existing_document_is_unusable() {
        for existing in [
            b"".as_slice(),
            b"not json".as_slice(),
            b"[1,2,3]".as_slice(),
        ] {
            let merged = merge_metadata_document(existing, br#"{"initialized":true}"#).unwrap();
            assert_eq!(json(&merged)["initialized"], Value::Bool(true));
        }
    }

    #[test]
    fn refuses_a_payload_that_would_erase_the_document() {
        // A bare array or string carries no keys; writing it would drop every
        // other feature's state, so it is refused rather than applied.
        assert!(merge_metadata_document(br#"{"theme":1}"#, br#"[1,2]"#).is_err());
        assert!(merge_metadata_document(br#"{"theme":1}"#, br#""hello""#).is_err());
        assert!(merge_metadata_document(br#"{"theme":1}"#, b"not json").is_err());
    }
}
