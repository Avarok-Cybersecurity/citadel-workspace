//! A promoted first member also initialises the workspace.
//!
//! The frontend shows its "Initialize & Become Admin" modal whenever the
//! workspace metadata lacks `initialized: true`. Promotion under
//! `WORKSPACE_ALLOW_FIRST_CONNECT_ADMIN` granted the role and did not write that
//! marker, so the one account that IS the administrator was asked to become one
//! — and declining the modal navigates back to the index rather than into the
//! workspace. The flag exists so `tilt up` → create an account → have editing
//! rights works without anyone typing the master password, and it only half did.
//!
//! These cover the decision and the document. The kernel path that joins them is
//! two lines with no branching of its own; what can go wrong is the outcome
//! (promote when it should not) and the merge (clobbering sibling keys), and
//! both are here.

use citadel_workspace_server_kernel::handlers::domain::server_ops::metadata_merge::merge_metadata_document;
use citadel_workspace_server_kernel::{first_member_outcome, FirstMemberOutcome};
use serde_json::Value;

const MARKER: &[u8] = br#"{"initialized":true}"#;

fn json(bytes: &[u8]) -> Value {
    serde_json::from_slice(bytes).expect("valid json")
}

#[test]
fn the_first_member_is_promoted_only_when_the_operator_asked() {
    // On, and the workspace is empty: promote, and therefore initialise.
    assert_eq!(
        first_member_outcome(true, true),
        FirstMemberOutcome::Promote
    );
    // Off: the workspace waits for the master password, and must NOT be marked
    // initialised — that would leave a production deployment with no owner and
    // no way to claim one.
    assert_eq!(
        first_member_outcome(false, true),
        FirstMemberOutcome::AwaitInitialization
    );
    // Somebody is already here: nobody is promoted whatever the flag says.
    assert_eq!(
        first_member_outcome(true, false),
        FirstMemberOutcome::JoinAsMember
    );
    assert_eq!(
        first_member_outcome(false, false),
        FirstMemberOutcome::JoinAsMember
    );
}

#[test]
fn the_marker_lands_on_an_empty_document() {
    let merged = merge_metadata_document(b"", MARKER).expect("merges");
    assert_eq!(json(&merged)["initialized"], Value::Bool(true));
}

#[test]
fn the_marker_keeps_the_keys_that_were_already_there() {
    // The seeded workspace carries theming; assigning over the document instead
    // of merging is the regression metadata_merge exists to prevent, and this
    // path is a third writer into it.
    let existing = br#"{"theme":{"name":"midnight"},"motd":"hello"}"#;
    let merged = merge_metadata_document(existing, MARKER).expect("merges");
    let value = json(&merged);
    assert_eq!(value["initialized"], Value::Bool(true));
    assert_eq!(value["theme"]["name"], Value::String("midnight".into()));
    assert_eq!(value["motd"], Value::String("hello".into()));
}

#[test]
fn an_explicit_false_is_replaced_rather_than_kept() {
    let merged = merge_metadata_document(br#"{"initialized":false}"#, MARKER).expect("merges");
    assert_eq!(json(&merged)["initialized"], Value::Bool(true));
}

/// The kernel actually writes the marker when it promotes.
///
/// The tests above cover the decision and the document, and a control that
/// removes the assignment in the kernel passes all four of them: nothing obliges
/// the promotion branch to use the merge it was written for. That is the shape
/// this campaign keeps finding — a helper with tests, and a call site with none.
///
/// A running kernel is what would settle it properly, and that needs a server.
/// Until then this reads the source, which is cheap and which fails for the one
/// mistake worth catching: promoting without marking.
#[test]
fn the_promotion_branch_writes_the_marker() {
    let source = include_str!("../src/kernel/async_kernel.rs");
    let promote = source
        .find("if outcome == crate::FirstMemberOutcome::Promote {")
        .expect("the promotion branch exists");
    // The branch, up to the members block that follows it.
    let branch = &source[promote..promote + 1_600];
    assert!(
        branch.contains("merge_metadata_document"),
        "the promotion branch must merge the initialisation marker",
    );
    assert!(
        branch.contains("ws.metadata = merged"),
        "merging without assigning leaves the marker unwritten",
    );
}
