//! What a profile update may store.
//!
//! `UpdateUserProfile` wrote `name` and `avatar_data` into the user record with
//! no length check, and any registered account can send it. On a public server,
//! where registration is open, one request with a multi-megabyte string grew
//! the store by that much, and every later write of that user rewrote it.

use citadel_sdk::prelude::NetworkError;

/// The longest base64 avatar accepted, in bytes.
///
/// The UI encodes a 256x256 image as WebP at quality 0.85, or as PNG where the
/// browser cannot encode WebP (`citadel-workspaces/src/lib/image-processor.ts`).
/// The largest of those is an incompressible 256x256 RGBA PNG: about 263 KB,
/// about 351 KB as base64. 512 KiB admits every avatar the app can produce
/// and nothing an order of magnitude larger.
pub const MAX_AVATAR_BASE64_LEN: usize = 512 * 1024;

/// Refuse a profile update the server should not store.
///
/// A display name follows the rule the server applies to the full name at
/// registration, read from the settings the server actually runs with
/// (`production_server_misc_settings`) rather than restated, so the two cannot
/// drift apart.
pub fn check_profile_update(name: Option<&str>, avatar: Option<&str>) -> Result<(), NetworkError> {
    if let Some(name) = name {
        let reqs = crate::production_server_misc_settings().credential_requirements;
        let (min, max) = (reqs.min_name_length as usize, reqs.max_name_length as usize);
        if name.len() < min || name.len() > max {
            return Err(NetworkError::msg(format!(
                "A display name must be {min} to {max} bytes; this one is {}.",
                name.len()
            )));
        }
    }
    if let Some(avatar) = avatar {
        if avatar.len() > MAX_AVATAR_BASE64_LEN {
            return Err(NetworkError::msg(format!(
                "An avatar may be at most {MAX_AVATAR_BASE64_LEN} bytes of base64; this one is {}.",
                avatar.len()
            )));
        }
    }
    Ok(())
}
