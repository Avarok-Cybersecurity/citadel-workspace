//! What `UpdateUserProfile` changes on a user record, and which of it other
//! members may read.
//!
//! Pure functions over `User`, so the rules are tested without a kernel: the
//! handler checks, locks, reads, calls `apply_profile_update`, and writes.

use std::collections::HashMap;

use citadel_workspace_types::structs::{MetadataValue, User};

pub use super::identity_binding::{BindingWrite, IDENTITY_BINDING_KEY};

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
/// `User.metadata` key holding whether other members may be shown the user's presence.
pub const SHOWS_ONLINE_STATUS_KEY: &str = "shows_online_status";

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
///
/// `shows_online_status` likewise: presence comes from the Citadel server's
/// peer list, which reports it to everyone, so the only party able to withhold
/// it is the viewer's client -- and it can only do that if it can read this.
///
/// `identity_binding` likewise, and outside `PROFILE_DETAIL_KEYS`: it is how
/// any member, stranger or not, learns this account is the same person as an
/// account elsewhere, and it verified before it was stored.
pub const MEMBER_VISIBLE_KEYS: [&str; 6] = [
    AVATAR_KEY,
    EMAIL_KEY,
    TITLE_KEY,
    ACCEPTS_REQUESTS_FROM_STRANGERS_KEY,
    SHOWS_ONLINE_STATUS_KEY,
    IDENTITY_BINDING_KEY,
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
    /// Stored under `SHOWS_ONLINE_STATUS_KEY`.
    pub shows_online_status: Option<bool>,
    /// Stored under `IDENTITY_BINDING_KEY`, once `identity_binding::check_binding_write`
    /// accepts it against the stored one.
    pub identity_binding: Option<BindingWrite>,
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
    set_flag(
        &mut user.metadata,
        SHOWS_ONLINE_STATUS_KEY,
        update.shows_online_status,
    );
    if let Some(binding) = update.identity_binding {
        user.metadata.insert(
            IDENTITY_BINDING_KEY.to_string(),
            MetadataValue::String(binding.blob_base64url),
        );
    }
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
