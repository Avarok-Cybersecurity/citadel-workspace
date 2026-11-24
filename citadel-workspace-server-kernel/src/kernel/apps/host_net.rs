//! What `HostNetGrant` answers: the reach one install has from one member's machine now, through
//! the member's agent (`net.host` fetches and `citadel.session` sessions), or nothing. The agent
//! enforces this answer, not the page's claim, so a page cannot widen its own hosts or servers,
//! or reach a private network its installer may no longer grant.
//!
//! Pure: the handler (`command_processor::apps_host_net_grant`) reads the install, the manifest
//! of the release it runs, what it may do now for the member (`apps_gather::effective_for`) and
//! whether the member turned it off.

use citadel_workspace_types::apps::Capability;
use citadel_workspace_types::apps_install::{AppInstall, HostNetGrant, InstallState};
use citadel_workspace_types::apps_manifest::AppManifest;
use std::collections::BTreeSet;

/// `install`'s reach for a member for whom it may do `effective`, `running` being the manifest
/// of the release it runs, or None when it may reach nothing: suspended, turned off by the
/// member, or neither `net.host` nor `citadel.session` effective (ungranted, the installer
/// demoted, or the install not reaching the member). Each part is answered only while its
/// capability is effective: the hosts and `private` with `net.host`, the servers and limits with
/// `citadel.session`.
pub fn host_net_grant(
    install: &AppInstall,
    running: &AppManifest,
    effective: &BTreeSet<Capability>,
    disabled_for_me: bool,
) -> Option<HostNetGrant> {
    let suspended = matches!(install.state, InstallState::Suspended { .. });
    let host = effective.contains(&Capability::NetHost);
    let session = effective.contains(&Capability::CitadelSession);
    if suspended || disabled_for_me || !(host || session) {
        return None;
    }
    Some(HostNetGrant {
        app_id: install.app_id.clone(),
        hosts: if host {
            install.details.host_network_hosts.clone()
        } else {
            Vec::new()
        },
        private: host && effective.contains(&Capability::NetHostPrivate),
        servers: if session {
            session_servers(running)
        } else {
            Vec::new()
        },
        session: running.limits.session.clone().filter(|_| session),
    })
}

/// The servers `manifest`'s `citadel.session` request names, empty when it makes none.
fn session_servers(manifest: &AppManifest) -> Vec<String> {
    manifest
        .capabilities
        .iter()
        .filter(|r| r.cap == Capability::CitadelSession)
        .find_map(|r| r.servers.clone())
        .unwrap_or_default()
}
