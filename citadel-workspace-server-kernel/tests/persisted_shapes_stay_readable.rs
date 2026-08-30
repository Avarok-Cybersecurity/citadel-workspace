//! # A record written by yesterday's binary must still load in today's
//!
//! Everything the workspace owns — the tree, the workspace itself, its users,
//! the schema — is persisted as JSON under a backend key and read back with
//! `serde_json::from_slice`. `backend_get` propagates a deserialize failure
//! rather than swallowing it, which is the right choice: the alternative is an
//! upgrade that quietly reports an empty workspace.
//!
//! But propagating it means a field added without `#[serde(default)]` does not
//! degrade the server, it stops it. Every stored `DomainNode` fails to parse,
//! `get_all_nodes` errors, and every operation that touches the tree — which is
//! all of them — fails against data still perfectly intact on disk. The
//! workspace is unreachable until someone ships a fix.
//!
//! Nothing tested that, and no test built the way the others are built could:
//! they construct a value in Rust from the current struct and round-trip it, so
//! the shape on both sides is the shape being changed and the change is
//! invisible.
//!
//! These fixtures are the shape as it stands, frozen on disk, deliberately NOT
//! generated from the structs at test time. Adding a field with a default keeps
//! them loading. Adding one without breaks them here, in the commit that does
//! it, instead of on an operator's machine after an upgrade.
//!
//! When a field is legitimately added: give it `#[serde(default)]`, or write a
//! migration in `async_kernel.rs`'s version block and record the new shape as a
//! second fixture. Do not edit these files to make the test pass — they are what
//! is already on disk in the field.

use citadel_workspace_types::structs::{DomainNode, TreeSchema, User, Workspace};

fn fixture(name: &str) -> String {
    let path = format!("{}/tests/fixtures/{name}", env!("CARGO_MANIFEST_DIR"));
    std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("read {path}: {e}"))
}

#[test]
fn a_stored_domain_node_still_loads() {
    let node: DomainNode = serde_json::from_str(&fixture("domain_node.json")).expect(
        "a DomainNode written by an older binary no longer deserializes -- give the new \
         field #[serde(default)] or migrate it; do not edit the fixture",
    );
    assert_eq!(node.id, "office-1");
    assert_eq!(node.name, "Engineering");
    // The permissions block is nested and has 26 fields of its own, which is
    // exactly where a new flag lands without anyone thinking about storage.
    assert!(node.default_permissions.view_content);
}

#[test]
fn a_stored_user_still_loads() {
    let user: User = serde_json::from_str(&fixture("user.json")).expect(
        "a User written by an older binary no longer deserializes -- give the new field \
         #[serde(default)] or migrate it; do not edit the fixture",
    );
    assert_eq!(user.id, "alice");
    assert_eq!(user.name, "Alice");
}

#[test]
fn a_stored_workspace_still_loads() {
    let workspace: Workspace = serde_json::from_str(&fixture("workspace.json")).expect(
        "a Workspace written by an older binary no longer deserializes -- give the new \
         field #[serde(default)] or migrate it; do not edit the fixture",
    );
    assert_eq!(workspace.id, "workspace-root");
    assert_eq!(workspace.name, "Acme");
}

#[test]
fn a_stored_tree_schema_still_loads() {
    let schema: TreeSchema = serde_json::from_str(&fixture("tree_schema.json")).expect(
        "a TreeSchema written by an older binary no longer deserializes -- give the new \
         field #[serde(default)] or migrate it; do not edit the fixture",
    );
    assert_eq!(schema.id, "default");
    assert!(!schema.rules.is_empty());
}
