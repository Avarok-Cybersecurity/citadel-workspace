//! Accepted terms are current only when both versions are the required ones.

use citadel_workspace_types::terms::{CurrentTerms, TermsDocument, PLATFORM_TERMS_VERSION};

fn terms(workspace: Option<u32>) -> CurrentTerms {
    CurrentTerms {
        platform: TermsDocument {
            version: PLATFORM_TERMS_VERSION,
            text: "platform".to_string(),
        },
        workspace: workspace.map(|version| TermsDocument {
            version,
            text: "workspace".to_string(),
        }),
    }
}

#[test]
fn the_current_platform_version_is_required() {
    assert!(terms(None).accepted_by(Some(PLATFORM_TERMS_VERSION), None));
    assert!(!terms(None).accepted_by(None, None));
    assert!(!terms(None).accepted_by(Some(PLATFORM_TERMS_VERSION + 1), None));
}

#[test]
fn workspace_terms_are_required_only_when_the_workspace_has_them() {
    assert!(terms(None).accepted_by(Some(PLATFORM_TERMS_VERSION), Some(4)));
    assert!(terms(Some(2)).accepted_by(Some(PLATFORM_TERMS_VERSION), Some(2)));
    assert!(!terms(Some(2)).accepted_by(Some(PLATFORM_TERMS_VERSION), Some(1)));
    assert!(!terms(Some(2)).accepted_by(Some(PLATFORM_TERMS_VERSION), None));
}

/// Bumping `PLATFORM_TERMS_VERSION` is what re-asks existing members: what they accepted is the
/// number stored with their consent, and nothing below the current version is current.
#[test]
fn a_member_who_accepted_the_previous_platform_version_owes_the_current_one() {
    // Checked when the test compiles, not at run time (clippy: assertions_on_constants).
    const _: () = assert!(
        PLATFORM_TERMS_VERSION >= 2,
        "the terms have been bumped at least once"
    );
    assert!(!terms(None).accepted_by(Some(PLATFORM_TERMS_VERSION - 1), None));
    assert!(!terms(Some(3)).accepted_by(Some(PLATFORM_TERMS_VERSION - 1), Some(3)));
}
