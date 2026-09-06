//! The config we ship must deserialize into the type that reads it.
//!
//! `docker/workspace-server/workspaces.json` was written against an older
//! `DomainPermissions` and never updated when its fields were generalised from
//! office/room names to node names. Measured: **14 keys in the file existed
//! nowhere in the struct** (`create_room`, `manage_office_members`, …) and
//! **10 required fields of the struct were absent from the file**.
//!
//! Nothing caught it because `kernel.toml` ships with `workspace_structure`
//! commented out. Uncomment it — which is the documented way to configure a
//! workspace — and the load fails, and that load is fatal, so the server
//! refuses to start. An operator following the instructions gets a serde error
//! naming one arbitrary missing field and a server that will not boot.
//!
//! Two changes make that unrepeatable, and they are deliberately different in
//! kind:
//!
//!   - `DomainPermissions` is now `#[serde(default)]`, so an absent field takes
//!     its default instead of taking the whole read down. That protects STORED
//!     records too, which is the same reason `themes` already had a default.
//!   - This test catches the other half — a key that no longer exists — which
//!     `serde(default)` cannot see, because serde ignores unknown fields.
//!     `deny_unknown_fields` would catch it at runtime but would also reject a
//!     live stored record carrying a field since dropped, so the check belongs
//!     here rather than in the type.
//!
//! WHAT THIS DOES NOT ASSERT: that the loaded permissions have any effect.
//! `default_permissions` is written to every node and read by NO code path —
//! `DomainPermissions::has_permission` has zero callers — so the shipped
//! "Announcements" room configured with `send_messages: false` does not stop
//! anyone posting. That is a product decision about the permissions model, not
//! a bug to fix quietly, and it is recorded in docs/ROBUSTNESS.md.

use std::path::PathBuf;

/// The shipped config, relative to this crate.
fn shipped_config() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("the kernel crate has a parent directory")
        .join("docker/workspace-server/workspaces.json")
}

#[test]
fn the_file_we_ship_is_where_we_think_it_is() {
    // Floor. Every assertion below is over this file; if it moved, they would
    // all pass over nothing and report the config as fine.
    let path = shipped_config();
    assert!(
        path.exists(),
        "shipped workspaces.json not found at {} — this test examined nothing",
        path.display()
    );
    let raw = std::fs::read_to_string(&path).expect("readable");
    assert!(
        raw.contains("default_permissions"),
        "the shipped config carries no default_permissions block, so nothing here is tested"
    );
}

#[test]
fn every_permission_key_we_ship_exists_in_the_type() {
    let raw = std::fs::read_to_string(shipped_config()).expect("readable");
    let doc: serde_json::Value = serde_json::from_str(&raw).expect("the shipped config is JSON");

    // A round trip through the real type. Unknown keys survive it silently, so
    // compare the keys directly rather than trusting deserialization to object.
    let mut checked = 0usize;
    let mut unknown: Vec<String> = Vec::new();

    fn walk(node: &serde_json::Value, checked: &mut usize, unknown: &mut Vec<String>) {
        match node {
            serde_json::Value::Object(map) => {
                if let Some(serde_json::Value::Object(perms)) = map.get("default_permissions") {
                    *checked += 1;
                    // Deserializing into the type and back out drops anything
                    // the type does not have; whatever the file had and the
                    // round trip lost was never going to take effect.
                    let parsed: citadel_workspace_types::structs::DomainPermissions =
                        serde_json::from_value(serde_json::Value::Object(perms.clone())).expect(
                            "DomainPermissions is serde(default), so this cannot fail on absence",
                        );
                    let round_tripped = serde_json::to_value(&parsed).expect("serializable");
                    let known = round_tripped.as_object().expect("an object");
                    for key in perms.keys() {
                        if !known.contains_key(key) {
                            unknown.push(key.clone());
                        }
                    }
                }
                for value in map.values() {
                    walk(value, checked, unknown);
                }
            }
            serde_json::Value::Array(items) => {
                for item in items {
                    walk(item, checked, unknown);
                }
            }
            _ => {}
        }
    }

    walk(&doc, &mut checked, &mut unknown);

    assert!(
        checked > 0,
        "no default_permissions block was examined — the config's shape changed"
    );
    unknown.sort();
    unknown.dedup();
    assert!(
        unknown.is_empty(),
        "the shipped config sets {} permission key(s) that DomainPermissions does not have, so \
         they are silently ignored and the operator's intent is lost: {:?}\n\
         (these were renamed when office/room permissions were generalised to node permissions)",
        unknown.len(),
        unknown
    );
}
