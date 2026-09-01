//! The browser's credential limits must match the SDK's.
//!
//! `citadel-workspaces/src/lib/credential-rules.ts` mirrors six constants
//! across a language boundary — the SSOT rule normally forbids that, and the
//! module says so, but a browser cannot read Rust constants and the choice is
//! between mirroring them and shipping no client-side validation at all.
//!
//! That comment also promised this test by name. It did not exist: a repo-wide
//! grep for `credential_mirror` returned exactly one line, the comment itself.
//! The numbers were correct, so nothing was broken — but the next SDK bump
//! would have moved them silently, and a reader who checked would have
//! believed they were covered.
//!
//! Read from the SDK rather than restated here, so the assertion cannot drift
//! along with the thing it is checking.

use citadel_user::credentials::{
    MAX_NAME_LENGTH, MAX_PASSWORD_LENGTH, MAX_USERNAME_LENGTH, MIN_NAME_LENGTH,
    MIN_PASSWORD_LENGTH, MIN_USERNAME_LENGTH,
};

/// Kept in step with `CREDENTIAL_LIMITS` in credential-rules.ts.
///
/// Deliberately literals: if this file simply re-exported the SDK constants the
/// test would pass no matter what the TypeScript said, which is the failure
/// mode it exists to prevent.
const TS_USERNAME: (u8, u8) = (3, 37);
const TS_PASSWORD: (u8, u8) = (7, 17);
const TS_FULL_NAME: (u8, u8) = (2, 77);

#[test]
fn the_typescript_mirror_matches_the_sdk() {
    assert_eq!(
        (MIN_USERNAME_LENGTH, MAX_USERNAME_LENGTH),
        TS_USERNAME,
        "username limits moved in the SDK; update CREDENTIAL_LIMITS.username in \
         citadel-workspaces/src/lib/credential-rules.ts to match"
    );
    assert_eq!(
        (MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH),
        TS_PASSWORD,
        "password limits moved in the SDK; update CREDENTIAL_LIMITS.password in \
         citadel-workspaces/src/lib/credential-rules.ts to match"
    );
    assert_eq!(
        (MIN_NAME_LENGTH, MAX_NAME_LENGTH),
        TS_FULL_NAME,
        "full-name limits moved in the SDK; update CREDENTIAL_LIMITS.fullName in \
         citadel-workspaces/src/lib/credential-rules.ts to match"
    );
}
