//! What `HostNetGrant` answers: the `net.host` reach one install has from one member's machine
//! now, or nothing. The member's agent enforces this answer, not the page's claim, so a page
//! cannot widen its own hosts or reach a private network its installer may no longer grant.
//!
//! Pure: the handler (`command_processor::apps_host_net_grant`) reads the install, what it may
//! do now for the member (`apps_gather::effective_for`) and whether the member turned it off.

use citadel_workspace_types::apps::Capability;
use citadel_workspace_types::apps_install::{AppInstall, HostNetGrant, InstallState};
use std::collections::BTreeSet;

/// `install`'s `net.host` reach for a member for whom it may do `effective`, or None when it may
/// reach nothing: suspended, turned off by the member, or `net.host` not effective (ungranted,
/// the installer demoted, or the install not reaching the member).
pub fn host_net_grant(
    install: &AppInstall,
    effective: &BTreeSet<Capability>,
    disabled_for_me: bool,
) -> Option<HostNetGrant> {
    let suspended = matches!(install.state, InstallState::Suspended { .. });
    if suspended || disabled_for_me || !effective.contains(&Capability::NetHost) {
        return None;
    }
    Some(HostNetGrant {
        app_id: install.app_id.clone(),
        hosts: install.details.host_network_hosts.clone(),
        private: effective.contains(&Capability::NetHostPrivate),
    })
}
