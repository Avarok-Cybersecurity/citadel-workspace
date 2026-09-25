//! What `UpdateUserProfile` changes on a user record, and which of it other
//! members may read.
//!
//! Pure functions over `User`, so the rules are tested without a kernel: the
//! handler checks, locks, reads, calls `apply_profile_update`, and writes.

use std::collections::HashMap;

use citadel_workspace_types::structs::{MetadataValue, User};

/// `User.metadata` key holding the base64 avatar.
pub const AVATAR_KEY: &str = "avatar";
/// `User.metadata` key holding the contact email.
pub const EMAIL_KEY: &str = "email";
/// `User.metadata` key holding the job title.
pub const TITLE_KEY: &str = "title";
/// `User.metadata` key holding whether non-contacts may see the profile fields.
pub const SHOW_PROFILE_TO_STRANGERS_KEY: &str = "show_profile_to_strangers";
/// `User.metadata` key holding whether the user takes requests from strangers.
pub const ACCEPTS_REQUESTS_FROM_STRANGERS_KEY: &str = "accepts_requests_from_strangers";

/// The fields `show_profile_to_strangers` governs.
pub const PROFILE_DETAIL_KEYS: [&str; 3] = [AVATAR_KEY, EMAIL_KEY, TITLE_KEY];

/// Metadata a non-admin member may read on another member's record.
///
/// `ListMembers` strips all metadata for non-admins and keeps only these: the
/// profile a user is told, at sign-up, that members of the workspace can see.
/// The avatar is among them -- it is a picture the user chose to show, and
/// without it every other member saw initials only. Those three are further
/// subject to the owner's `show_profile_to_strangers` (`profile_visibility`).
///
/// `accepts_requests_from_strangers` is here because it exists to be read by
/// others: it is how a refused requester learns the refusal was a policy.
pub const MEMBER_VISIBLE_KEYS: [&str; 4] = [
    AVATAR_KEY,
    EMAIL_KEY,
    TITLE_KEY,
    ACCEPTS_REQUESTS_FROM_STRANGERS_KEY,
];

/// One profile update as received. `None` leaves a field unchanged.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProfileUpdate {
    pub name: Option<String>,
    pub avatar_data: Option<String>,
    /// `Some("")` removes the stored email (and likewise for the avatar and title).
    pub email: Option<String>,
    /// `Some("")` removes the stored title.
    pub title: Option<String>,
    /// Stored under `SHOW_PROFILE_TO_STRANGERS_KEY`; see `profile_visibility`.
    pub show_profile_to_strangers: Option<bool>,
    /// Stored under `ACCEPTS_REQUESTS_FROM_STRANGERS_KEY`.
    pub accepts_requests_from_strangers: Option<bool>,
}

/// Apply an already-checked update to `user`.
pub fn apply_profile_update(user: &mut User, update: ProfileUpdate) {
    if let Some(name) = update.name {
        user.name = name;
    }
    set_or_clear(&mut user.metadata, AVATAR_KEY, update.avatar_data);
    set_or_clear(&mut user.metadata, EMAIL_KEY, update.email);
    set_or_clear(&mut user.metadata, TITLE_KEY, update.title);
    set_flag(
        &mut user.metadata,
        SHOW_PROFILE_TO_STRANGERS_KEY,
        update.show_profile_to_strangers,
    );
    set_flag(
        &mut user.metadata,
        ACCEPTS_REQUESTS_FROM_STRANGERS_KEY,
        update.accepts_requests_from_strangers,
    );
}

fn set_flag(metadata: &mut HashMap<String, MetadataValue>, key: &str, value: Option<bool>) {
    if let Some(v) = value {
        metadata.insert(key.to_string(), MetadataValue::Boolean(v));
    }
}

fn set_or_clear(metadata: &mut HashMap<String, MetadataValue>, key: &str, value: Option<String>) {
    match value {
        None => {}
        Some(v) if v.is_empty() => {
            metadata.remove(key);
        }
        Some(v) => {
            metadata.insert(key.to_string(), MetadataValue::String(v));
        }
    }
}

/// The part of `metadata` a non-admin member may see on someone else's record.
pub fn member_visible_metadata(
    metadata: &HashMap<String, MetadataValue>,
) -> HashMap<String, MetadataValue> {
    MEMBER_VISIBLE_KEYS
        .iter()
        .filter_map(|key| metadata.get(*key).map(|v| (key.to_string(), v.clone())))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use citadel_workspace_types::structs::UserRole;

    fn user() -> User {
        User::new("u".into(), "U".into(), UserRole::Member)
    }

    fn update(email: Option<&str>, title: Option<&str>) -> ProfileUpdate {
        ProfileUpdate {
            name: None,
            avatar_data: None,
            email: email.map(str::to_string),
            title: title.map(str::to_string),
            show_profile_to_strangers: None,
            accepts_requests_from_strangers: None,
        }
    }

    fn text(user: &User, key: &str) -> Option<String> {
        match user.metadata.get(key) {
            Some(MetadataValue::String(s)) => Some(s.clone()),
            _ => None,
        }
    }

    #[test]
    fn email_and_title_are_stored() {
        let mut u = user();
        apply_profile_update(&mut u, update(Some("a@b.c"), Some("Engineer")));
        assert_eq!(text(&u, EMAIL_KEY).as_deref(), Some("a@b.c"));
        assert_eq!(text(&u, TITLE_KEY).as_deref(), Some("Engineer"));
    }

    #[test]
    fn an_absent_field_leaves_the_stored_value() {
        let mut u = user();
        apply_profile_update(&mut u, update(Some("a@b.c"), Some("Engineer")));
        apply_profile_update(&mut u, update(None, None));
        assert_eq!(text(&u, EMAIL_KEY).as_deref(), Some("a@b.c"));
        assert_eq!(text(&u, TITLE_KEY).as_deref(), Some("Engineer"));
    }

    #[test]
    fn an_empty_avatar_clears_the_stored_one() {
        let mut u = user();
        let with_avatar = ProfileUpdate {
            name: None,
            avatar_data: Some("AAAA".into()),
            email: None,
            title: None,
            show_profile_to_strangers: None,
            accepts_requests_from_strangers: None,
        };
        apply_profile_update(&mut u, with_avatar.clone());
        assert!(u.metadata.contains_key(AVATAR_KEY));
        apply_profile_update(
            &mut u,
            ProfileUpdate {
                avatar_data: Some(String::new()),
                ..with_avatar
            },
        );
        assert!(!u.metadata.contains_key(AVATAR_KEY));
    }

    #[test]
    fn an_empty_string_clears_the_field() {
        let mut u = user();
        apply_profile_update(&mut u, update(Some("a@b.c"), Some("Engineer")));
        apply_profile_update(&mut u, update(Some(""), Some("")));
        assert!(!u.metadata.contains_key(EMAIL_KEY));
        assert!(!u.metadata.contains_key(TITLE_KEY));
    }

    #[test]
    fn members_see_the_avatar_email_and_title_and_nothing_else() {
        let mut u = user();
        apply_profile_update(
            &mut u,
            ProfileUpdate {
                name: None,
                avatar_data: Some("AAAA".into()),
                email: Some("a@b.c".into()),
                title: Some("Engineer".into()),
                show_profile_to_strangers: None,
                accepts_requests_from_strangers: None,
            },
        );
        u.metadata
            .insert("other".into(), MetadataValue::String("x".into()));
        let visible = member_visible_metadata(&u.metadata);
        let mut keys: Vec<&str> = visible.keys().map(String::as_str).collect();
        keys.sort_unstable();
        assert_eq!(keys, vec![AVATAR_KEY, EMAIL_KEY, TITLE_KEY]);
    }
}
