//! Which of a member's profile details another account is sent.
//!
//! "Profile Visibility" is a promise the SERVER has to keep: the avatar, email
//! and title live on the user record here and `ListMembers` / `GetMember` hand
//! them out. Hiding them in the owner's own client would stop nobody.
//!
//! "Contact" means a mutual P2P registration, which the Citadel server records
//! when two accounts register with each other; the kernel reads it from the
//! same SDK account store (`BackendTransactionManager::p2p_contacts_of`).
//!
//! Pure functions, so the rule is tested without a kernel or an SDK node.

use std::collections::{HashMap, HashSet};

use citadel_workspace_types::structs::{MetadataValue, User};

use super::profile_update::{
    member_visible_metadata, PROFILE_DETAIL_KEYS, SHOW_PROFILE_TO_STRANGERS_KEY,
};

/// What `show_profile_to_strangers` means on a record that has never set it.
///
/// `true`, deliberately and visibly: every record written before this setting
/// existed was created under the sign-up form's promise that the email and
/// title are "visible to members of this workspace", and hiding them now would
/// change what those users agreed to without asking. A user who wants them
/// hidden says so, and from then on the stored value governs.
pub const SHOW_PROFILE_TO_STRANGERS_WHEN_UNSET: bool = true;

/// How the viewer stands to the record's owner.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Viewer {
    /// Reading their own record: always sent in full.
    Owner,
    /// Another account. `is_admin` widens what non-profile metadata is sent;
    /// it does not override the owner's profile choice.
    Other { is_admin: bool, is_contact: bool },
}

/// Whether the owner lets non-contacts see their profile details.
pub fn shows_profile_to_strangers(metadata: &HashMap<String, MetadataValue>) -> bool {
    match metadata.get(SHOW_PROFILE_TO_STRANGERS_KEY) {
        Some(MetadataValue::Boolean(show)) => *show,
        _ => SHOW_PROFILE_TO_STRANGERS_WHEN_UNSET,
    }
}

/// Whether the account `user_id` is among `contacts`, the CIDs
/// `BackendTransactionManager::p2p_contacts_of` returns. Kernel user ids are
/// usernames, and the SDK derives an account's CID from its username.
pub fn is_contact(contacts: &HashSet<u64>, user_id: &str) -> bool {
    contacts.contains(&citadel_types::user::username_to_cid(user_id))
}

/// `user` as `viewer_id` is sent it. `contacts` is only consulted for a record
/// whose owner hides their profile, so a caller holding no such record
/// (`hides_profile`) may skip the SDK read and pass an empty set.
///
/// A non-admin never gets the permissions map of someone else's record: it is
/// the enforced authorization state of the workspace, not roster information.
pub fn user_for_viewer(
    user: User,
    viewer_id: &str,
    is_admin: bool,
    contacts: &HashSet<u64>,
) -> User {
    if user.id == viewer_id {
        return user;
    }
    let viewer = Viewer::Other {
        is_admin,
        is_contact: is_contact(contacts, &user.id),
    };
    User {
        metadata: metadata_for_viewer(&user.metadata, viewer),
        permissions: if is_admin {
            user.permissions
        } else {
            Default::default()
        },
        ..user
    }
}

/// Whether `user` has hidden their profile, i.e. whether sending their record
/// to someone else requires knowing that person's contacts.
pub fn hides_profile(user: &User) -> bool {
    !shows_profile_to_strangers(&user.metadata)
}

/// The part of `metadata` that `viewer` is sent.
pub fn metadata_for_viewer(
    metadata: &HashMap<String, MetadataValue>,
    viewer: Viewer,
) -> HashMap<String, MetadataValue> {
    let Viewer::Other {
        is_admin,
        is_contact,
    } = viewer
    else {
        return metadata.clone();
    };
    let mut sent = if is_admin {
        metadata.clone()
    } else {
        member_visible_metadata(metadata)
    };
    if !is_contact && !shows_profile_to_strangers(metadata) {
        for key in PROFILE_DETAIL_KEYS {
            sent.remove(key);
        }
    }
    sent
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::kernel::profile_update::ACCEPTS_REQUESTS_FROM_STRANGERS_KEY;

    fn profile(show: Option<bool>) -> HashMap<String, MetadataValue> {
        let mut m: HashMap<String, MetadataValue> = ["avatar", "email", "title", "other"]
            .into_iter()
            .map(|k| (k.to_string(), MetadataValue::String("x".into())))
            .collect();
        m.insert(
            ACCEPTS_REQUESTS_FROM_STRANGERS_KEY.to_string(),
            MetadataValue::Boolean(false),
        );
        if let Some(show) = show {
            m.insert(
                SHOW_PROFILE_TO_STRANGERS_KEY.to_string(),
                MetadataValue::Boolean(show),
            );
        }
        m
    }

    fn keys(m: &HashMap<String, MetadataValue>) -> Vec<&str> {
        let mut k: Vec<&str> = m.keys().map(String::as_str).collect();
        k.sort_unstable();
        k
    }

    const STRANGER: Viewer = Viewer::Other {
        is_admin: false,
        is_contact: false,
    };
    const CONTACT: Viewer = Viewer::Other {
        is_admin: false,
        is_contact: true,
    };
    const ADMIN_STRANGER: Viewer = Viewer::Other {
        is_admin: true,
        is_contact: false,
    };

    #[test]
    fn a_stranger_gets_none_of_a_hidden_profile() {
        let sent = metadata_for_viewer(&profile(Some(false)), STRANGER);
        assert_eq!(keys(&sent), vec![ACCEPTS_REQUESTS_FROM_STRANGERS_KEY]);
    }

    #[test]
    fn a_contact_gets_a_hidden_profile() {
        let sent = metadata_for_viewer(&profile(Some(false)), CONTACT);
        assert_eq!(
            keys(&sent),
            vec![
                ACCEPTS_REQUESTS_FROM_STRANGERS_KEY,
                "avatar",
                "email",
                "title"
            ]
        );
    }

    #[test]
    fn a_stranger_gets_a_shown_profile() {
        let sent = metadata_for_viewer(&profile(Some(true)), STRANGER);
        assert_eq!(
            keys(&sent),
            vec![
                ACCEPTS_REQUESTS_FROM_STRANGERS_KEY,
                "avatar",
                "email",
                "title"
            ]
        );
    }

    #[test]
    fn an_unset_choice_reads_as_the_documented_constant() {
        assert_eq!(
            shows_profile_to_strangers(&profile(None)),
            SHOW_PROFILE_TO_STRANGERS_WHEN_UNSET
        );
    }

    #[test]
    fn an_admin_keeps_the_rest_of_the_record_but_not_the_hidden_profile() {
        let sent = metadata_for_viewer(&profile(Some(false)), ADMIN_STRANGER);
        assert_eq!(
            keys(&sent),
            vec![
                ACCEPTS_REQUESTS_FROM_STRANGERS_KEY,
                "other",
                SHOW_PROFILE_TO_STRANGERS_KEY
            ]
        );
    }

    #[test]
    fn the_owner_gets_everything() {
        let full = profile(Some(false));
        assert_eq!(metadata_for_viewer(&full, Viewer::Owner), full);
    }
}
