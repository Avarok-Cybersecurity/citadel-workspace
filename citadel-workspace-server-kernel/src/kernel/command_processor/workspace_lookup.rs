//! What to tell a client when a workspace lookup fails.
//!
//! This decision used to be a substring search over the error's prose:
//!
//! ```ignore
//! if error_msg.contains("not found") || error_msg.contains("Not a member")
//! ```
//!
//! `WorkspaceNotInitialized` is not a small thing to say. The client treats it
//! as "this server has never been set up" and shows the first-run flow, which
//! asks for the workspace master password and offers to create the workspace.
//! Saying it to somebody whose workspace exists and is fine sends them to
//! re-initialise a live server.
//!
//! Two things were wrong with deciding that by reading a sentence:
//!
//!  - **"not found" is not specific to a workspace.** Asking about an id that
//!    does not exist produced it, and so would any future message with those
//!    words in it. A wrong id is a wrong id; it says nothing about whether the
//!    server is set up.
//!  - **The producer and the reader had nothing keeping them in step.** The
//!    messages live in `async_domain_server_ops`; renaming one there silently
//!    changed what this file concluded, with nothing failing.
//!
//! Both messages are now named constants that the producer uses, and the tests
//! drive the real command processor — so a rename that breaks the link fails.

use citadel_workspace_types::WorkspaceProtocolResponse;

pub use crate::handlers::domain::workspace_errors::{NOT_A_MEMBER, NO_SUCH_WORKSPACE};

/// Why a workspace lookup failed, as a fact rather than a sentence.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LookupFailure {
    NoSuchWorkspace,
    NotAMember,
    Other,
}

/// Read one of the two known failures out of an error message.
///
/// Exact equality against the constants above, not a substring search: a
/// message that merely CONTAINS "not found" is some other operation's failure,
/// and answering it as though it were this one is how a live server came to be
/// described as uninitialised.
pub fn classify(message: &str) -> LookupFailure {
    if message == NOT_A_MEMBER {
        LookupFailure::NotAMember
    } else if message == NO_SUCH_WORKSPACE {
        LookupFailure::NoSuchWorkspace
    } else {
        LookupFailure::Other
    }
}

/// The response for a failed `GetWorkspace`.
///
/// `is_root` is what makes `WorkspaceNotInitialized` sayable at all. That answer
/// is a statement about THE SERVER — "nothing has been set up here" — so only a
/// request about the root workspace can earn it. A request naming some other id
/// that fails is a fact about that id.
///
/// A caller who is not a member of the root workspace still gets
/// `WorkspaceNotInitialized`, which is not right either: they are being told the
/// server is empty when they are simply not in it. Fixing that properly needs a
/// response variant the protocol does not have yet, and adding one means
/// regenerating the TypeScript bindings and rebuilding the stack. Recorded in
/// docs/ROBUSTNESS.md rather than papered over — but it is now a decision with
/// a name on it instead of a coincidence of wording.
pub fn response_for(
    is_root: bool,
    failure: LookupFailure,
    detail: &str,
) -> WorkspaceProtocolResponse {
    match failure {
        LookupFailure::NoSuchWorkspace | LookupFailure::NotAMember if is_root => {
            WorkspaceProtocolResponse::WorkspaceNotInitialized
        }
        LookupFailure::NoSuchWorkspace => {
            WorkspaceProtocolResponse::Error(format!("No such workspace: {detail}"))
        }
        LookupFailure::NotAMember => WorkspaceProtocolResponse::Error(format!(
            "You are not a member of this workspace: {detail}"
        )),
        LookupFailure::Other => {
            WorkspaceProtocolResponse::Error(format!("Failed to get workspace: {detail}"))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_message_that_merely_contains_the_words_is_not_one_of_these() {
        assert_eq!(classify("Office not found"), LookupFailure::Other);
        assert_eq!(classify("User not found"), LookupFailure::Other);
        assert_eq!(
            classify("Permission denied: Not a member of this office"),
            LookupFailure::Other
        );
    }

    #[test]
    fn the_two_real_ones_are_recognised() {
        assert_eq!(classify(NO_SUCH_WORKSPACE), LookupFailure::NoSuchWorkspace);
        assert_eq!(classify(NOT_A_MEMBER), LookupFailure::NotAMember);
    }

    #[test]
    fn only_the_root_workspace_can_be_called_uninitialised() {
        assert!(matches!(
            response_for(true, LookupFailure::NoSuchWorkspace, "x"),
            WorkspaceProtocolResponse::WorkspaceNotInitialized
        ));
        assert!(matches!(
            response_for(false, LookupFailure::NoSuchWorkspace, "x"),
            WorkspaceProtocolResponse::Error(_)
        ));
        assert!(matches!(
            response_for(false, LookupFailure::NotAMember, "x"),
            WorkspaceProtocolResponse::Error(_)
        ));
    }

    #[test]
    fn an_unrelated_failure_is_never_reported_as_uninitialised() {
        // Not even on the root: a backend that is down says nothing about
        // whether a workspace was ever created.
        assert!(matches!(
            response_for(true, LookupFailure::Other, "backend unavailable"),
            WorkspaceProtocolResponse::Error(_)
        ));
    }
}
