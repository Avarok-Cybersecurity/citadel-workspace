//! `profile_update`'s rules, over plain `User` records.

use super::profile_update::*;
use citadel_workspace_types::structs::{MetadataValue, User, UserRole};

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
        shows_online_status: None,
        identity_binding: None,
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
        shows_online_status: None,
        identity_binding: None,
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
            shows_online_status: None,
            identity_binding: None,
        },
    );
    u.metadata
        .insert("other".into(), MetadataValue::String("x".into()));
    let visible = member_visible_metadata(&u.metadata);
    let mut keys: Vec<&str> = visible.keys().map(String::as_str).collect();
    keys.sort_unstable();
    assert_eq!(keys, vec![AVATAR_KEY, EMAIL_KEY, TITLE_KEY]);
}

#[test]
fn the_presence_choice_is_stored_and_members_can_read_it() {
    let mut u = user();
    apply_profile_update(
        &mut u,
        ProfileUpdate {
            shows_online_status: Some(false),
            ..update(None, None)
        },
    );
    let visible = member_visible_metadata(&u.metadata);
    assert_eq!(
        visible.get(SHOWS_ONLINE_STATUS_KEY),
        Some(&MetadataValue::Boolean(false))
    );
}
