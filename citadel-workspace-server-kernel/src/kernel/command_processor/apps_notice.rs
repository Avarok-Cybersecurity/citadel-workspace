//! What the workspace's other members are told when an apps answer changes something they hold:
//! the installs a page runs (`InstallsChanged`, so its zones read them again) or the answers the
//! kernel would give about two members (`PeerAnswersChanged`, so their pages drop the
//! `AuthorizePeer` answers they hold). Both notices are content-free: which install, whose consent
//! and whom a member blocked are not anyone else's to read, and each page asks again for what it
//! may see. The caller is answered as before and is not told twice. Pure.

use citadel_workspace_types::apps_responses::AppsResponse;

/// The notice the other members get for `answer`, if it changed anything they hold.
pub(super) fn notice_for(answer: &AppsResponse) -> Option<AppsResponse> {
    match answer {
        AppsResponse::Installed { .. }
        | AppsResponse::Uninstalled { .. }
        | AppsResponse::Updated { .. }
        | AppsResponse::RolledBack { .. }
        | AppsResponse::Consented { .. } => Some(AppsResponse::InstallsChanged),
        AppsResponse::DisabledForMe { .. }
        | AppsResponse::PeerConsentForMe { .. }
        | AppsResponse::PeerBlockedForMe { .. } => Some(AppsResponse::PeerAnswersChanged),
        _ => None,
    }
}
