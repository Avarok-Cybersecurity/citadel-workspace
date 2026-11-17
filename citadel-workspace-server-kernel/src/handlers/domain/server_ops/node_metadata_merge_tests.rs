//! `merge_node_metadata` and the workspace's tab keys: each rule refused on its own.

use super::node_metadata::MAX_NODE_METADATA_BYTES;
use super::node_metadata_merge::*;
use citadel_workspace_types::node_tabs::PROVISIONED_DEFAULT_APP_TABS;
use serde_json::{json, Value};

fn merged(existing: Value, patch: Value) -> Result<Value, String> {
    let existing = serde_json::to_vec(&existing).unwrap();
    let patch = serde_json::to_vec(&patch).unwrap();
    merge_node_metadata(&existing, &patch).map(|bytes| serde_json::from_slice(&bytes).unwrap())
}

fn app_ids(n: usize) -> Value {
    json!((0..n)
        .map(|i| format!("com.acme.app{i}"))
        .collect::<Vec<_>>())
}

#[test]
fn a_merge_keeps_the_keys_it_does_not_name() {
    let stored = json!({"citadel_app": {"v": 1}, "opaque": [1, 2]});
    let out = merged(
        stored,
        json!({"app_tabs": ["com.acme.kanban"], "other": true}),
    )
    .unwrap();
    assert_eq!(out["citadel_app"], json!({"v": 1}));
    assert_eq!(out["opaque"], json!([1, 2]));
    assert_eq!(out["other"], json!(true));
    assert_eq!(out["app_tabs"], json!(["com.acme.kanban"]));
}

#[test]
fn an_empty_list_is_stored_because_it_means_no_app_tabs() {
    let out = merged(json!({}), json!({"app_tabs": []})).unwrap();
    assert_eq!(out["app_tabs"], json!([]));
}

#[test]
fn null_removes_the_list_so_the_node_follows_the_workspace_again() {
    let stored = json!({"app_tabs": ["com.acme.kanban"], "time_zone": "Europe/Berlin", "k": 1});
    let out = merged(stored, json!({"app_tabs": null, "time_zone": null})).unwrap();
    assert!(out.get("app_tabs").is_none());
    assert!(out.get("time_zone").is_none());
    assert_eq!(out["k"], json!(1));
}

#[test]
fn nine_app_tabs_are_refused_and_eight_are_kept() {
    assert!(merged(json!({}), json!({"app_tabs": app_ids(8)})).is_ok());
    assert!(merged(json!({}), json!({"app_tabs": app_ids(9)})).is_err());
}

#[test]
fn an_invalid_or_repeated_app_id_is_refused() {
    assert!(merged(json!({}), json!({"app_tabs": ["Kanban"]})).is_err());
    assert!(merged(json!({}), json!({"app_tabs": ["com.acme.a", "com.acme.a"]})).is_err());
    assert!(merged(json!({}), json!({"app_tabs": "com.acme.a"})).is_err());
}

#[test]
fn the_citadel_app_of_a_node_cannot_be_changed_or_added() {
    let stored = json!({"citadel_app": {"payload": {"app": "docs"}}});
    let other = json!({"citadel_app": {"payload": {"app": "sheets"}}});
    assert!(merged(stored.clone(), other).is_err());
    assert!(merged(
        json!({}),
        json!({"citadel_app": {"payload": {"app": "docs"}}})
    )
    .is_err());
    assert!(merged(stored.clone(), json!({"citadel_app": null})).is_err());
    // Sending the stored value back unchanged is not a change.
    assert!(merged(stored.clone(), stored).is_ok());
}

#[test]
fn an_unknown_time_zone_is_refused_and_a_known_one_kept() {
    assert!(merged(json!({}), json!({"time_zone": "Mars/Olympus_Mons"})).is_err());
    assert!(merged(json!({}), json!({"time_zone": "UTC+2"})).is_err());
    let out = merged(json!({}), json!({"time_zone": "Asia/Tokyo"})).unwrap();
    assert_eq!(out["time_zone"], json!("Asia/Tokyo"));
}

#[test]
fn a_patch_that_is_not_an_object_is_refused() {
    assert!(merge_node_metadata(b"{}", b"[1]").is_err());
    assert!(merge_node_metadata(b"{}", b"not json").is_err());
}

#[test]
fn a_merge_that_outgrows_the_cap_is_refused() {
    let half = "x".repeat(MAX_NODE_METADATA_BYTES / 2 + 1);
    let stored = json!({ "a": half.clone() });
    assert!(merged(stored, json!({ "b": half })).is_err());
}

#[test]
fn the_workspace_patch_checks_its_tab_and_zone_keys() {
    let check = |v: Value| check_workspace_metadata_patch(&serde_json::to_vec(&v).unwrap());
    assert!(check(json!({"default_app_tabs": ["net.avarok.calendar"]})).is_ok());
    assert!(check(json!({"default_app_tabs": []})).is_ok());
    assert!(check(json!({"default_app_tabs": app_ids(9)})).is_err());
    assert!(check(json!({"default_app_tabs": null})).is_err());
    assert!(check(json!({"time_zone": "Nowhere/Else"})).is_err());
    assert!(check(json!({"initialized": true})).is_ok());
}

#[test]
fn provisioning_adds_the_default_tabs_once_and_never_over_a_choice() {
    let fresh = provisioned_default_app_tabs(br#"{"initialized":true}"#)
        .unwrap()
        .expect("a workspace without the key is provisioned");
    let fresh: Value = serde_json::from_slice(&fresh).unwrap();
    assert_eq!(
        fresh["default_app_tabs"],
        json!(PROVISIONED_DEFAULT_APP_TABS)
    );
    assert_eq!(fresh["initialized"], json!(true));
    assert!(provisioned_default_app_tabs(b"").unwrap().is_some());
    assert_eq!(
        provisioned_default_app_tabs(br#"{"default_app_tabs":[]}"#).unwrap(),
        None
    );
}
