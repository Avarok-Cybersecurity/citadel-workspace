//! What a profile update may store.
//!
//! `UpdateUserProfile` wrote `name` and `avatar_data` into the user record with
//! no length check, and any registered account can send it. On a public server,
//! where registration is open, one request with a multi-megabyte string grew
//! the store by that much, and every later write of that user rewrote it.

use citadel_sdk::prelude::NetworkError;

use super::profile_update::ProfileUpdate;

/// The longest base64 avatar accepted, in bytes.
///
/// The UI encodes a 256x256 image as WebP at quality 0.85, or as PNG where the
/// browser cannot encode WebP (`citadel-workspaces/src/lib/image-processor.ts`).
/// The largest of those is an incompressible 256x256 RGBA PNG: about 263 KB,
/// about 351 KB as base64. 512 KiB admits every avatar the app can produce
/// and nothing an order of magnitude larger.
pub const MAX_AVATAR_BASE64_LEN: usize = 512 * 1024;

/// The longest contact email accepted, in bytes: RFC 5321's path limit.
pub const MAX_EMAIL_LEN: usize = 254;

/// The longest job title accepted, in bytes.
pub const MAX_TITLE_LEN: usize = 64;

/// Refuse a profile update the server should not store.
///
/// A display name follows the rule the server applies to the full name at
/// registration, read from the settings the server actually runs with
/// (`production_server_misc_settings`) rather than restated, so the two cannot
/// drift apart.
///
/// An empty email or title is a request to clear it and is always accepted.
pub fn check_profile_update(update: &ProfileUpdate) -> Result<(), NetworkError> {
    if let Some(name) = update.name.as_deref() {
        let reqs = crate::production_server_misc_settings().credential_requirements;
        let (min, max) = (reqs.min_name_length as usize, reqs.max_name_length as usize);
        if name.len() < min || name.len() > max {
            return Err(NetworkError::msg(format!(
                "A display name must be {min} to {max} bytes; this one is {}.",
                name.len()
            )));
        }
    }
    if let Some(avatar) = update.avatar_data.as_deref() {
        if avatar.len() > MAX_AVATAR_BASE64_LEN {
            return Err(NetworkError::msg(format!(
                "An avatar may be at most {MAX_AVATAR_BASE64_LEN} bytes of base64; this one is {}.",
                avatar.len()
            )));
        }
    }
    if let Some(email) = update.email.as_deref().filter(|e| !e.is_empty()) {
        check_email(email)?;
    }
    if let Some(title) = update.title.as_deref() {
        if title.len() > MAX_TITLE_LEN {
            return Err(NetworkError::msg(format!(
                "A job title may be at most {MAX_TITLE_LEN} bytes; this one is {}.",
                title.len()
            )));
        }
    }
    Ok(())
}

/// A shape check, not validation: one `@`, something either side of it, no
/// whitespace. Whether the address exists is not the server's to know.
fn check_email(email: &str) -> Result<(), NetworkError> {
    if email.len() > MAX_EMAIL_LEN {
        return Err(NetworkError::msg(format!(
            "An email may be at most {MAX_EMAIL_LEN} bytes; this one is {}.",
            email.len()
        )));
    }
    let shaped = match email.split_once('@') {
        Some((local, domain)) => {
            !local.is_empty()
                && !domain.is_empty()
                && !domain.contains('@')
                && !email.chars().any(char::is_whitespace)
        }
        None => false,
    };
    if !shaped {
        return Err(NetworkError::msg(
            "An email must look like name@domain, with no spaces.",
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn with(email: Option<&str>, title: Option<&str>) -> ProfileUpdate {
        ProfileUpdate {
            name: None,
            avatar_data: None,
            email: email.map(str::to_string),
            title: title.map(str::to_string),
        }
    }

    #[test]
    fn a_plain_email_is_accepted() {
        for email in ["a@b", "ada.lovelace+work@example.co.uk"] {
            assert!(
                check_profile_update(&with(Some(email), None)).is_ok(),
                "{email}"
            );
        }
    }

    #[test]
    fn a_misshapen_email_is_refused() {
        for email in [
            "ada",
            "@example.com",
            "ada@",
            "a@b@c",
            "ada @example.com",
            "ada@exa\tmple.com",
        ] {
            assert!(
                check_profile_update(&with(Some(email), None)).is_err(),
                "{email:?} accepted"
            );
        }
    }

    #[test]
    fn email_length_is_bounded_at_254_bytes() {
        let at_limit = format!("{}@b", "a".repeat(MAX_EMAIL_LEN - 2));
        assert_eq!(at_limit.len(), MAX_EMAIL_LEN);
        assert!(check_profile_update(&with(Some(&at_limit), None)).is_ok());
        let over = format!("a{at_limit}");
        assert!(check_profile_update(&with(Some(&over), None)).is_err());
    }

    #[test]
    fn title_length_is_bounded_at_64_bytes() {
        let at_limit = "t".repeat(MAX_TITLE_LEN);
        assert!(check_profile_update(&with(None, Some(&at_limit))).is_ok());
        let over = "t".repeat(MAX_TITLE_LEN + 1);
        assert!(check_profile_update(&with(None, Some(&over))).is_err());
        // Bytes, not characters: 33 two-byte characters are 66 bytes.
        let multibyte = "é".repeat(33);
        assert!(check_profile_update(&with(None, Some(&multibyte))).is_err());
    }

    #[test]
    fn an_empty_string_clears_and_is_accepted() {
        assert!(check_profile_update(&with(Some(""), Some(""))).is_ok());
    }
}
