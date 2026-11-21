//! # Today's stored shapes, frozen on disk
//!
//! Everything the workspace owns (the tree, the workspace itself, its users, the schema) is
//! persisted as JSON under a backend key and read back with `serde_json::from_slice`, and a
//! deserialize failure is propagated rather than read as an empty workspace.
//!
//! These fixtures are the shape as this server writes it, deliberately NOT generated from the
//! structs at test time, so a change to a stored shape fails here, in the commit that makes it.
//! Such a change must bump `CURRENT_SCHEMA_VERSION` (kernel/schema_version.rs), which refuses
//! a store written by an earlier server; then re-record these fixtures. Stores are never
//! migrated.

use citadel_workspace_types::structs::{DomainNode, TreeSchema, User, Workspace};

fn fixture(name: &str) -> String {
    let path = format!("{}/tests/fixtures/{name}", env!("CARGO_MANIFEST_DIR"));
    std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("read {path}: {e}"))
}

#[test]
fn a_stored_domain_node_still_loads() {
    let node: DomainNode = serde_json::from_str(&fixture("domain_node.json")).expect(
        "a DomainNode no longer reads as stored -- bump CURRENT_SCHEMA_VERSION and re-record",
    );
    assert_eq!(node.id, "office-1");
    assert_eq!(node.name, "Engineering");
    // The permissions block is nested and has 26 fields of its own, which is
    // exactly where a new flag lands without anyone thinking about storage.
    assert!(node.default_permissions.view_content);
    // The permissions block omits "Members can see each other", which reads as visible.
    assert!(node.default_permissions.view_members);
}

#[test]
fn a_stored_user_still_loads() {
    let user: User = serde_json::from_str(&fixture("user.json"))
        .expect("a User no longer reads as stored -- bump CURRENT_SCHEMA_VERSION and re-record");
    assert_eq!(user.id, "alice");
    assert!(!user.is_banned());
    assert_eq!(user.name, "Alice");
}

#[test]
fn a_stored_workspace_still_loads() {
    let workspace: Workspace = serde_json::from_str(&fixture("workspace.json")).expect(
        "a Workspace no longer reads as stored -- bump CURRENT_SCHEMA_VERSION and re-record",
    );
    assert_eq!(workspace.id, "workspace-root");
    assert_eq!(workspace.name, "Acme");
}

#[test]
fn a_stored_tree_schema_still_loads() {
    let schema: TreeSchema = serde_json::from_str(&fixture("tree_schema.json")).expect(
        "a TreeSchema no longer reads as stored -- bump CURRENT_SCHEMA_VERSION and re-record",
    );
    assert_eq!(schema.id, "default");
    assert!(!schema.rules.is_empty());
}

#[test]
fn a_node_without_its_content_hash_is_refused() {
    let mut node: serde_json::Value = serde_json::from_str(&fixture("domain_node.json")).unwrap();
    node["mdx_content_hash"] = serde_json::Value::Null;
    assert!(serde_json::from_value::<DomainNode>(node.clone()).is_err());
    node.as_object_mut().unwrap().remove("mdx_content_hash");
    assert!(serde_json::from_value::<DomainNode>(node).is_err());
}
