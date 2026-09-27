//! A hierarchy schema is checked whole before it is saved.
//!
//! UpdateTreeSchema stored whatever the caller sent: `rules: []` (which the validator reads as
//! "anything may nest anywhere"), a type with no label, a Workspace nested under an Office, a
//! cycle, a `max_depth` that cut off rooms that already exist. The graph editor makes all of
//! those one drag away, so the server holds the line and says which rule was broken.
//!
//! No mocks: a pure function over real schemas.
use citadel_workspace_server_kernel::handlers::domain::schema_rules::{
    validate_schema, SchemaProblem,
};
use citadel_workspace_types::structs::{EntityTypeConfig, NestingRule, TreeSchema};

fn config(name: &str) -> EntityTypeConfig {
    EntityTypeConfig {
        type_name: name.to_string(),
        icon: "folder".to_string(),
        label: name.to_string(),
        plural_label: format!("{name}s"),
        name_placeholder: String::new(),
        description_placeholder: String::new(),
        chat_default: true,
    }
}

fn rule(parent: &str, children: &[&str]) -> NestingRule {
    NestingRule {
        parent_type: parent.to_string(),
        allowed_child_types: children.iter().map(|c| c.to_string()).collect(),
    }
}

fn schema(rules: Vec<NestingRule>, types: &[&str]) -> TreeSchema {
    TreeSchema {
        id: "s".to_string(),
        name: "s".to_string(),
        rules,
        max_depth: None,
        entity_type_configs: types.iter().map(|t| config(t)).collect(),
    }
}

fn problems(s: &TreeSchema) -> Vec<SchemaProblem> {
    validate_schema(s).expect_err("expected the schema to be refused")
}

#[test]
fn the_default_schema_is_valid_and_three_levels_deep() {
    assert_eq!(
        validate_schema(&TreeSchema::default()),
        Ok(2),
        "Workspace(0) → Office(1) → Room(2)"
    );
}

#[test]
fn a_deeper_custom_hierarchy_is_valid() {
    let s = schema(
        vec![
            rule("Workspace", &["Division"]),
            rule("Division", &["Department"]),
            rule("Department", &["Team"]),
        ],
        &["Workspace", "Division", "Department", "Team"],
    );
    assert_eq!(validate_schema(&s), Ok(3));
}

#[test]
fn no_rules_is_refused_rather_than_read_as_anything_goes() {
    assert!(problems(&schema(vec![], &["Workspace"])).contains(&SchemaProblem::NoRootRule));
}

#[test]
fn a_workspace_cannot_be_nested() {
    let s = schema(
        vec![
            rule("Workspace", &["Office"]),
            rule("Office", &["Workspace"]),
        ],
        &["Workspace", "Office"],
    );
    assert!(problems(&s).contains(&SchemaProblem::WorkspaceNested("Office".into())));
}

#[test]
fn a_cycle_is_refused() {
    let s = schema(
        vec![
            rule("Workspace", &["A"]),
            rule("A", &["B"]),
            rule("B", &["A"]),
        ],
        &["Workspace", "A", "B"],
    );
    assert!(problems(&s)
        .iter()
        .any(|p| matches!(p, SchemaProblem::Cycle(_))));
}

#[test]
fn every_level_needs_a_label() {
    let s = schema(vec![rule("Workspace", &["Office"])], &["Workspace"]);
    assert!(problems(&s).contains(&SchemaProblem::MissingConfig("Office".into())));
}

#[test]
fn names_labels_and_icons_are_held_to_what_the_client_can_show() {
    let mut s = schema(
        vec![rule("Workspace", &["Office"])],
        &["Workspace", "Office"],
    );
    s.entity_type_configs[1].icon = "https://evil.example/x.svg".to_string();
    s.entity_type_configs[1].label = "x".repeat(41);
    s.entity_type_configs.push(config("Office"));
    let found = problems(&s);
    assert!(
        found.contains(&SchemaProblem::UnknownIcon("Office".into())),
        "{found:?}"
    );
    assert!(
        found.contains(&SchemaProblem::LabelTooLong("Office".into())),
        "{found:?}"
    );
    assert!(
        found.contains(&SchemaProblem::DuplicateType("Office".into())),
        "{found:?}"
    );

    let bad_name = schema(
        vec![rule("Workspace", &["Of<fice"])],
        &["Workspace", "Of<fice"],
    );
    assert!(problems(&bad_name).contains(&SchemaProblem::BadTypeName("Of<fice".into())));
}
