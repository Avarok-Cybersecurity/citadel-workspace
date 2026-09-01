//! An unruled parent in a schema that has rules.
//!
//! `is_child_allowed` returned true for a parent type no rule mentions, while
//! its sibling `get_allowed_children` returned nothing for the same parent —
//! so the UI offered no child there and the validator accepted any. A custom
//! node type without a rule was a hole in an otherwise enforced schema.

use citadel_workspace_types::structs::{NestingRule, TreeSchema};

fn schema_with_one_rule() -> TreeSchema {
    TreeSchema {
        rules: vec![NestingRule {
            parent_type: "Office".to_string(),
            allowed_child_types: vec!["Room".to_string()],
        }],
        ..TreeSchema::default()
    }
}

#[test]
fn an_unruled_parent_allows_nothing() {
    let schema = schema_with_one_rule();

    assert!(
        !schema.is_child_allowed("CustomThing", "Room"),
        "a parent type no rule mentions must not become an unconstrained container"
    );
}

#[test]
fn agrees_with_get_allowed_children() {
    let schema = schema_with_one_rule();

    for parent in ["Office", "CustomThing", "Room"] {
        let listed = schema.get_allowed_children(parent);
        for child in ["Room", "Office", "CustomThing"] {
            assert_eq!(
                schema.is_child_allowed(parent, child),
                listed.iter().any(|c| c == child),
                "the validator and the list disagree about {child} under {parent}"
            );
        }
    }
}

#[test]
fn a_schema_with_no_rules_constrains_nothing() {
    // This is the state a workspace boots in, and it must stay permissive --
    // failing closed here would make an unconfigured workspace unusable.
    let schema = TreeSchema {
        rules: vec![],
        ..TreeSchema::default()
    };

    assert!(schema.is_child_allowed("anything", "anything else"));
}

#[test]
fn a_ruled_parent_still_allows_its_own_children() {
    let schema = schema_with_one_rule();

    assert!(schema.is_child_allowed("Office", "Room"));
    assert!(!schema.is_child_allowed("Office", "Office"));
}
