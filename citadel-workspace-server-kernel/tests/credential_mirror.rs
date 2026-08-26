//! Guards the TypeScript mirror of the SDK's credential contract.
//!
//! `citadel-workspaces/src/lib/credential-rules.ts` duplicates these numbers so
//! the registration form can validate before submitting rather than after a
//! round-trip. That duplication is only safe while it stays in sync, and
//! nothing about bumping the citadel-sdk pin would otherwise reveal that the
//! browser had begun enforcing stale limits — the form would simply start
//! accepting values the server rejects, which is the exact failure the TS
//! module exists to prevent.
//!
//! Asserted through `ServerMiscSettings::default()` rather than the raw
//! constants: that is the value the running server actually enforces, so this
//! also catches the SDK changing which requirements it applies by default.
//! Neither this crate nor the internal service overrides
//! `credential_requirements`, so the defaults are the live contract.
//!
//! If this fails, update CREDENTIAL_LIMITS and the validators in
//! credential-rules.ts to match, then update the numbers here.

use citadel_sdk::prelude::*;

#[test]
fn ts_credential_rules_still_match_the_sdk() {
    let reqs = ServerMiscSettings::default().credential_requirements;

    assert_eq!(
        reqs.min_username_length, 3,
        "credential-rules.ts username.min"
    );
    assert_eq!(
        reqs.max_username_length, 37,
        "credential-rules.ts username.max"
    );
    assert_eq!(
        reqs.min_password_length, 7,
        "credential-rules.ts password.min"
    );
    assert_eq!(
        reqs.max_password_length, 17,
        "credential-rules.ts password.max"
    );
    assert_eq!(reqs.min_name_length, 2, "credential-rules.ts fullName.min");
    assert_eq!(reqs.max_name_length, 77, "credential-rules.ts fullName.max");
}
