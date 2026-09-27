//! The name other members see for an account.
//!
//! The connect handler created every user record with `name` set to the
//! username (`User::new(user_id, user_id, ..)`), and the full name the account
//! registered with -- which the SDK keeps on the server's own account record --
//! was never read. So a user who signed up as "Bob Brown" appeared as `bob0924`
//! in every member row, chat header and request list.
//!
//! The registered full name is now the display name for a new record, and an
//! existing record still carrying the username placeholder is repaired on its
//! next connect. A name the user chose (`UpdateUserProfile`) is never replaced:
//! only the placeholder is.

use citadel_sdk::prelude::{NetworkError, Ratchet};
use citadel_workspace_types::structs::User;

use super::transaction::BackendTransactionManager;

/// The display name for an account: its registered full name, or the username
/// when the SDK has none to give.
pub fn display_name_for(user_id: &str, registered_full_name: Option<&str>) -> String {
    match registered_full_name.map(str::trim) {
        Some(full) if !full.is_empty() => full.to_string(),
        _ => user_id.to_string(),
    }
}

/// The name to write onto an existing record, or `None` to leave it alone.
///
/// Only a record whose name is still the username placeholder is changed.
pub fn repaired_name(user: &User, registered_full_name: Option<&str>) -> Option<String> {
    if user.name != user.id {
        return None;
    }
    let wanted = display_name_for(&user.id, registered_full_name);
    (wanted != user.name).then_some(wanted)
}

/// Repair `user_id`'s placeholder name in storage, under the user-writer lock.
///
/// Returns whether a write happened. An absent record is not an error: the
/// enrolment that follows creates it with the right name.
pub async fn repair_placeholder_name<R: Ratchet + Send + Sync + 'static>(
    backend: &BackendTransactionManager<R>,
    user_id: &str,
    registered_full_name: Option<&str>,
) -> Result<bool, NetworkError> {
    let _guard = backend.lock_workspaces().await;
    let Some(mut user) = backend.get_user(user_id).await? else {
        return Ok(false);
    };
    let Some(name) = repaired_name(&user, registered_full_name) else {
        return Ok(false);
    };
    user.name = name;
    backend.insert_user(user_id.to_string(), user).await?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use citadel_workspace_types::structs::UserRole;

    fn user(id: &str, name: &str) -> User {
        User::new(id.into(), name.into(), UserRole::Member)
    }

    #[test]
    fn the_registered_full_name_is_the_display_name() {
        assert_eq!(display_name_for("bob0924", Some("Bob Brown")), "Bob Brown");
    }

    #[test]
    fn the_username_stands_in_when_there_is_no_full_name() {
        assert_eq!(display_name_for("bob0924", None), "bob0924");
        assert_eq!(display_name_for("bob0924", Some("   ")), "bob0924");
    }

    #[test]
    fn a_placeholder_name_is_repaired() {
        assert_eq!(
            repaired_name(&user("bob0924", "bob0924"), Some("Bob Brown")).as_deref(),
            Some("Bob Brown")
        );
    }

    #[test]
    fn a_chosen_name_is_never_replaced() {
        assert_eq!(
            repaired_name(&user("bob0924", "Robert"), Some("Bob Brown")),
            None
        );
    }

    #[test]
    fn nothing_is_written_without_a_full_name() {
        assert_eq!(repaired_name(&user("bob0924", "bob0924"), None), None);
    }
}
