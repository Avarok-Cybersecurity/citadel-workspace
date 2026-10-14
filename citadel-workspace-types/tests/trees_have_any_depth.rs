//! The default tree: Workspace → [Office], Office → [Room, Office], Room → [Room], no depth cap.
//!
//! Rooms were leaves and the tree stopped at depth 3 only because the default schema said so.
//! Organisations are trees of any depth, so the default is now one.

use citadel_workspace_types::structs::TreeSchema;

#[test]
fn a_room_may_hold_rooms_and_an_office_offices() {
    let schema = TreeSchema::default();
    assert!(schema.is_child_allowed("Room", "Room"));
    assert!(schema.is_child_allowed("Office", "Office"));
    assert!(schema.is_child_allowed("Office", "Room"));
}

#[test]
fn the_workspace_still_holds_only_offices() {
    let schema = TreeSchema::default();
    assert!(schema.is_child_allowed("Workspace", "Office"));
    assert!(!schema.is_child_allowed("Workspace", "Room"));
    assert!(!schema.is_child_allowed("Room", "Office"));
}

#[test]
fn the_default_tree_has_no_depth_cap() {
    assert_eq!(TreeSchema::default().max_depth, None);
}

/// Seeding a configured workspace and the UI's single-type "Add Child" both take the first
/// allowed type, so an office's first child type stays Room.
#[test]
fn an_offices_first_child_type_is_still_room() {
    let schema = TreeSchema::default();
    assert_eq!(schema.root_child_types(), vec!["Office"]);
    assert_eq!(
        schema
            .get_allowed_children("Office")
            .first()
            .map(String::as_str),
        Some("Room")
    );
}
