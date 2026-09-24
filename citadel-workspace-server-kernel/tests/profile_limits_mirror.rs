//! The browser's profile-field limits must match the server's.
//!
//! `citadel-workspaces/src/lib/profile-rules.ts` mirrors two numbers across a
//! language boundary so the form can say "too long" before a round trip. Its
//! header names this test. Literals on purpose: re-exporting the Rust
//! constants here would pass whatever the TypeScript said.

use citadel_workspace_server_kernel::kernel::profile_limits::{MAX_EMAIL_LEN, MAX_TITLE_LEN};

/// Kept in step with `PROFILE_LIMITS` in profile-rules.ts.
const TS_EMAIL_MAX: usize = 254;
const TS_TITLE_MAX: usize = 64;

#[test]
fn profile_limits_mirror_matches_the_server() {
    assert_eq!(
        MAX_EMAIL_LEN, TS_EMAIL_MAX,
        "update PROFILE_LIMITS.email in citadel-workspaces/src/lib/profile-rules.ts"
    );
    assert_eq!(
        MAX_TITLE_LEN, TS_TITLE_MAX,
        "update PROFILE_LIMITS.title in citadel-workspaces/src/lib/profile-rules.ts"
    );
}
