//! Stored permission records written before a field existed must still load.
//!
//! `DomainPermissions` is embedded in `DomainNode`, which the backend reads back
//! with `serde_json::from_slice`. Records persisted before `themes` was added
//! have no such key, so a field without a Serde default fails the whole read
//! with `missing field themes` — and one unreadable record can take the stored
//! node map with it. On an upgrade that presents as data loss rather than as a
//! schema change.

use citadel_workspace_types::structs::DomainPermissions;

/// A record as an older build wrote it: today's shape, minus the new field.
///
/// Built by removing the key rather than by listing fields, so this keeps
/// testing the right thing as the struct grows instead of quietly drifting into
/// a stale copy of an old schema.
fn record_without(field: &str) -> String {
    let mut value = serde_json::to_value(DomainPermissions::default()).expect("serialise");
    let object = value.as_object_mut().expect("permissions serialise to an object");
    assert!(object.remove(field).is_some(), "`{field}` should exist to be removed");
    value.to_string()
}

#[test]
fn a_record_written_before_themes_existed_still_deserialises() {
    let legacy = record_without("themes");

    let parsed: DomainPermissions =
        serde_json::from_str(&legacy).expect("a stored record predating `themes` must load");

    // False, not true: an old record must not silently acquire a permission it
    // was never granted.
    assert!(!parsed.themes, "themes should default to denied for legacy records");
}

#[test]
fn the_rest_of_a_legacy_record_survives_intact() {
    let mut value =
        serde_json::to_value(DomainPermissions::default()).expect("serialise");
    let object = value.as_object_mut().expect("object");
    object.remove("themes");
    // Something explicitly true, so this cannot pass by everything defaulting.
    object.insert("view_content".into(), serde_json::Value::Bool(true));

    let parsed: DomainPermissions = serde_json::from_str(&value.to_string()).expect("load");

    assert!(parsed.view_content, "fields the record did carry must be preserved");
    assert!(!parsed.themes);
}

#[test]
fn a_current_record_round_trips() {
    let permissions = DomainPermissions { themes: true, ..DomainPermissions::default() };

    let encoded = serde_json::to_string(&permissions).expect("serialise");
    let decoded: DomainPermissions = serde_json::from_str(&encoded).expect("deserialise");

    assert_eq!(permissions, decoded);
    assert!(decoded.themes, "an explicit true must survive the round trip");
}
