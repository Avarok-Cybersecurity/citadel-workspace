//! Who becomes the administrator of an empty workspace.
//!
//! Registration has no invite gate. Unconditional promotion of the first member
//! meant that on a deployment reachable from anywhere, whoever found the port
//! and registered first became the administrator — a stranger, by race.
//!
//! The gate that fixed it was tested at the switch and never at the wire: the
//! existing tests pin the env-var resolver and that the flag is stored, so
//! reverting the decision to `let is_first_member = ws_was_empty;` left every
//! test green. The integration suite could not have caught it either — it runs
//! with `WORKSPACE_ALLOW_FIRST_CONNECT_ADMIN=1`, which makes the gated and
//! ungated versions behave identically.
//!
//! These tests are on the decision itself, which is why it was extracted from
//! the connection handler.

use citadel_workspace_server_kernel::{first_member_outcome, FirstMemberOutcome};

#[test]
fn a_stranger_who_registers_first_does_not_become_admin() {
    // The vulnerability, stated as a test: empty workspace, promotion not
    // asked for, first account through the door.
    assert_eq!(
        first_member_outcome(false, true),
        FirstMemberOutcome::AwaitInitialization,
        "the first account to reach an open deployment must not inherit the workspace"
    );
}

#[test]
fn a_dev_stack_that_asked_for_it_still_gets_an_admin() {
    // The promotion survives because a local stack genuinely needs it --
    // without it there is no administrator and no way to make one.
    assert_eq!(
        first_member_outcome(true, true),
        FirstMemberOutcome::Promote,
    );
}

#[test]
fn nobody_is_promoted_into_a_workspace_that_already_has_members() {
    // Both settings, because the flag must not override the emptiness check:
    // an enabled dev stack promoting every joiner would be a worse bug than
    // the one being fixed.
    for enabled in [true, false] {
        assert_eq!(
            first_member_outcome(enabled, false),
            FirstMemberOutcome::JoinAsMember,
            "enabled={enabled}"
        );
    }
}

#[test]
fn promotion_requires_both_conditions() {
    // Stated as the truth table, so a refactor that drops either input from
    // the expression fails here rather than in production.
    let table = [
        (true, true, FirstMemberOutcome::Promote),
        (true, false, FirstMemberOutcome::JoinAsMember),
        (false, true, FirstMemberOutcome::AwaitInitialization),
        (false, false, FirstMemberOutcome::JoinAsMember),
    ];

    for (enabled, empty, expected) in table {
        assert_eq!(
            first_member_outcome(enabled, empty),
            expected,
            "enabled={enabled} empty={empty}"
        );
    }
}
