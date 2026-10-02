//! The menu-bar app's secret for the agent's notice plane (agent kernel/notices).
//!
//! The app that starts the agent puts a fresh token in its environment -- never on the command
//! line, which any local process can list -- and subscribes with it. One subscriber hears every
//! signed-in account's notices, so without the token nobody may. A terminal-run agent has none,
//! and its notice plane stays shut.

use citadel_internal_service::kernel::notices::NoticeToken;
use citadel_internal_service::kernel::CitadelWorkspaceService;
use citadel_sdk::prelude::Ratchet;

pub(crate) const NOTICE_TOKEN_ENV: &str = "CITADEL_NOTICE_TOKEN";

/// `service`, with its notice plane open to the token in the environment, if there is one.
pub(crate) fn applied<T, R: Ratchet>(
    service: CitadelWorkspaceService<T, R>,
) -> CitadelWorkspaceService<T, R> {
    match token_from(std::env::var(NOTICE_TOKEN_ENV).ok()) {
        Some(token) => {
            citadel_logging::info!(target: "citadel", "Notice plane open to the app that started this agent");
            service.with_notice_token(token)
        }
        None => service,
    }
}

/// The token in `value`; none for an absent or empty one, which would admit an empty guess.
fn token_from(value: Option<String>) -> Option<NoticeToken> {
    value.and_then(NoticeToken::new)
}

#[cfg(test)]
mod tests {
    use super::token_from;

    #[test]
    fn only_a_non_empty_value_opens_the_notice_plane() {
        assert!(token_from(None).is_none());
        assert!(token_from(Some(String::new())).is_none());
        let token = token_from(Some("0123abcd".repeat(8))).expect("a token");
        assert!(
            !format!("{token:?}").contains("0123abcd"),
            "the token printed itself"
        );
    }
}
