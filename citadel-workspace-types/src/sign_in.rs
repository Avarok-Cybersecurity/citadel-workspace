//! How a workspace admits people to sign in and register.
//!
//! The setting is not stored with the workspace record: the server that enforces it reads it at
//! every sign-in, before any session exists, from wherever its host keeps it. A Durable Object
//! keeps it in its own key-value storage, where its admission check and its public discovery
//! endpoint read the same entry. The kernel reaches it through the host (`SignInSettingsStore`),
//! so there is one copy, not a workspace field and a host field that could disagree.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// The workspace's sign-in settings, as `GetSignInSettings` reads them and
/// `UpdateSignInSettings` writes them.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct SignInSettings {
    /// Everyone signing in or registering must pass a Cloudflare Turnstile check first. Off
    /// unless an admin turns it on.
    pub require_turnstile_sign_in: bool,
}

#[cfg(test)]
mod tests {
    use super::SignInSettings;

    #[test]
    fn the_wire_name_is_the_one_the_ui_reads() {
        let json = serde_json::to_string(&SignInSettings {
            require_turnstile_sign_in: true,
        })
        .unwrap();
        assert_eq!(json, r#"{"require_turnstile_sign_in":true}"#);
    }

    /// No silent default: a body without the field is refused rather than read as "off".
    #[test]
    fn a_missing_field_is_refused() {
        assert!(serde_json::from_str::<SignInSettings>("{}").is_err());
    }
}
