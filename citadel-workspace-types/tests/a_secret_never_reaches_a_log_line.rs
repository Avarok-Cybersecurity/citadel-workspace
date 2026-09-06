//! The workspace master password must not appear in a `Debug` rendering.
//!
//! `async_process_command` logs `"Processing command: {command:?} for user: ..."`
//! at `debug!`, and three variants of `WorkspaceProtocolRequest` carry
//! `workspace_master_password` as a plain `String`. So raising `RUST_LOG` to
//! `citadel=debug` -- which an operator does precisely when they are about to
//! paste a log into a ticket -- wrote the master password in clear on every
//! CreateWorkspace, UpdateWorkspace and DeleteWorkspace.
//!
//! The mechanism was already here and already in use. `#[debug(with = ...)]`
//! redacts the `metadata` byte blob on the line BELOW each of those password
//! fields, and `ServerConfig` in the kernel hand-writes a `Debug` that redacts
//! the same secret. It was applied to the byte blob and to one struct, and not
//! to the secret sitting next to it.
//!
//! Every variant that carries the field is asserted, not one of them: this is a
//! per-field attribute, so adding a fourth variant and forgetting the attribute
//! is the obvious next instance and the test should be the thing that says so.
//!
//! The positive control matters as much as the redaction. A `Debug` that
//! printed nothing at all would satisfy every "does not contain" assertion
//! here, and would also destroy the log line's purpose -- so each case also
//! asserts the fields that MUST still be legible.

use citadel_workspace_types::WorkspaceProtocolRequest;

/// A password distinctive enough that a substring match cannot be a coincidence.
const SECRET: &str = "correct-horse-battery-staple-9f3a";

fn create() -> WorkspaceProtocolRequest {
    WorkspaceProtocolRequest::CreateWorkspace {
        name: "Engineering".to_string(),
        description: "the workspace".to_string(),
        workspace_master_password: SECRET.to_string(),
        metadata: None,
    }
}

fn update() -> WorkspaceProtocolRequest {
    WorkspaceProtocolRequest::UpdateWorkspace {
        workspace_id: Some("ws-1".to_string()),
        name: Some("Renamed".to_string()),
        description: None,
        workspace_master_password: SECRET.to_string(),
        metadata: None,
    }
}

fn delete() -> WorkspaceProtocolRequest {
    WorkspaceProtocolRequest::DeleteWorkspace {
        workspace_id: Some("ws-1".to_string()),
        workspace_master_password: SECRET.to_string(),
    }
}

#[test]
fn create_workspace_does_not_print_the_master_password() {
    let rendered = format!("{:?}", create());
    assert!(
        !rendered.contains(SECRET),
        "the master password reached a Debug rendering: {rendered}",
    );
}

#[test]
fn update_workspace_does_not_print_the_master_password() {
    let rendered = format!("{:?}", update());
    assert!(
        !rendered.contains(SECRET),
        "the master password reached a Debug rendering: {rendered}",
    );
}

#[test]
fn delete_workspace_does_not_print_the_master_password() {
    let rendered = format!("{:?}", delete());
    assert!(
        !rendered.contains(SECRET),
        "the master password reached a Debug rendering: {rendered}",
    );
}

#[test]
fn the_rest_of_the_command_is_still_legible() {
    // The control. A `Debug` that printed nothing would satisfy all three
    // assertions above and destroy the log line those assertions exist to keep
    // safe -- the whole point of logging the command is to know which one it
    // was and what it was called.
    let rendered = format!("{:?}", create());
    assert!(rendered.contains("CreateWorkspace"), "{rendered}");
    assert!(rendered.contains("Engineering"), "{rendered}");

    let rendered = format!("{:?}", update());
    assert!(rendered.contains("UpdateWorkspace"), "{rendered}");
    assert!(rendered.contains("ws-1"), "{rendered}");

    let rendered = format!("{:?}", delete());
    assert!(rendered.contains("DeleteWorkspace"), "{rendered}");
    assert!(rendered.contains("ws-1"), "{rendered}");
}

#[test]
fn the_redaction_is_visible_rather_than_silent() {
    // A field that simply vanished would read as "this request had no password",
    // which is a different and misleading claim. Say that something was held
    // back.
    let rendered = format!("{:?}", create());
    assert!(
        rendered.contains("redacted"),
        "the password should be shown as withheld, not omitted: {rendered}",
    );
}
