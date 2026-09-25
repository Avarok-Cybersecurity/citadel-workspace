//! The browser's privacy keys and unset default must match the server's.
//!
//! `citadel-workspaces/src/lib/profile-privacy.ts` mirrors two metadata keys
//! and `SHOW_PROFILE_TO_STRANGERS_WHEN_UNSET` across a language boundary so the
//! Settings switch shows what the server enforces. Its header names this test.
//! Literals on purpose: re-exporting the Rust constants would pass whatever the
//! TypeScript said.

use citadel_workspace_server_kernel::kernel::profile_update::{
    ACCEPTS_REQUESTS_FROM_STRANGERS_KEY, SHOW_PROFILE_TO_STRANGERS_KEY,
};
use citadel_workspace_server_kernel::kernel::profile_visibility::SHOW_PROFILE_TO_STRANGERS_WHEN_UNSET;

/// Kept in step with `PRIVACY_METADATA_KEYS` and the unset default in profile-privacy.ts.
const TS_SHOW_KEY: &str = "show_profile_to_strangers";
const TS_ACCEPTS_KEY: &str = "accepts_requests_from_strangers";
const TS_SHOW_WHEN_UNSET: bool = true;

#[test]
fn profile_privacy_mirror_matches_the_server() {
    assert_eq!(
        SHOW_PROFILE_TO_STRANGERS_KEY, TS_SHOW_KEY,
        "update profile-privacy.ts"
    );
    assert_eq!(
        ACCEPTS_REQUESTS_FROM_STRANGERS_KEY, TS_ACCEPTS_KEY,
        "update profile-privacy.ts"
    );
    assert_eq!(
        SHOW_PROFILE_TO_STRANGERS_WHEN_UNSET, TS_SHOW_WHEN_UNSET,
        "update profile-privacy.ts"
    );
}
