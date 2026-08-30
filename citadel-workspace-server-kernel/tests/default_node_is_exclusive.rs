//! Exactly one node is the workspace's default.
//!
//! The client had a "Set as default" menu item that sent `is_default` in
//! `UpdateNode`. There was no such field on the Rust variant, serde ignores
//! unknown keys, the write succeeded, `awaitWriteResponse` resolved, and the
//! toast said "X is now the default" — while `is_default` never changed and the
//! old default came back on reload. The field the client was already sending
//! now exists, and this pins what it must do.
//!
//! The rule is exclusivity, which is the part that is easy to get wrong: a
//! default that is set without clearing the previous one leaves two, and the
//! workspace opens on whichever the map iterates first.

use std::collections::HashMap;

/// The exclusivity rule, extracted so it can be tested without a kernel, a
/// backend and a live session.
fn apply_default(nodes: &mut HashMap<String, bool>, node_id: &str, is_default: Option<bool>) {
    if is_default == Some(true) {
        for (id, flag) in nodes.iter_mut() {
            if id != node_id {
                *flag = false;
            }
        }
    }
    if let Some(value) = is_default {
        nodes.insert(node_id.to_string(), value);
    }
}

fn workspace() -> HashMap<String, bool> {
    HashMap::from([
        ("a".to_string(), true),
        ("b".to_string(), false),
        ("c".to_string(), false),
    ])
}

#[test]
fn setting_a_default_clears_the_previous_one() {
    let mut nodes = workspace();

    apply_default(&mut nodes, "b", Some(true));

    assert!(nodes["b"]);
    assert!(!nodes["a"], "two defaults leaves the open target ambiguous");
    assert_eq!(nodes.values().filter(|f| **f).count(), 1);
}

#[test]
fn clearing_a_default_does_not_promote_something_else() {
    // A legitimate thing to ask for, and silently choosing a replacement would
    // be the app deciding where the workspace opens on the user's behalf.
    let mut nodes = workspace();

    apply_default(&mut nodes, "a", Some(false));

    assert_eq!(nodes.values().filter(|f| **f).count(), 0);
}

#[test]
fn an_update_that_says_nothing_about_the_default_leaves_it_alone() {
    // Every other UpdateNode field travels in the same request. Renaming a node
    // must not disturb which one the workspace opens on.
    let mut nodes = workspace();

    apply_default(&mut nodes, "b", None);

    assert!(nodes["a"]);
    assert!(!nodes["b"]);
}

#[test]
fn setting_the_current_default_again_is_idempotent() {
    let mut nodes = workspace();

    apply_default(&mut nodes, "a", Some(true));

    assert!(nodes["a"]);
    assert_eq!(nodes.values().filter(|f| **f).count(), 1);
}
