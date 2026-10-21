//! What a call may do: the install's grant, narrowed by what the installer may still grant, what
//! the acting member holds, and the install's reach, at the time of the call.

use super::rules::*;
use super::test_facts::{caps, holds, perms};
use citadel_workspace_types::apps::Capability;
use citadel_workspace_types::apps_install::AppsRefusal;
use citadel_workspace_types::structs::Permission;

#[test]
fn effective_capabilities_are_the_intersection_of_all_four() {
    let granted = caps(&[
        Capability::Canvas,
        Capability::NodesRead,
        Capability::ChatSend,
        Capability::NetServer,
    ]);
    let installer = holds(perms(&[
        Permission::AppInstall,
        Permission::AppInstallAllowNodeRead,
        Permission::AppInstallAllowChat,
        Permission::AppInstallAllowServerNetwork,
    ]));
    let viewer = holds(perms(&[Permission::ViewContent]));
    let effective = effective_capabilities(&granted, &installer, &viewer, true);
    // ChatSend needs SendMessages, which this viewer lacks; NetServer needs nothing of them.
    assert_eq!(
        effective,
        caps(&[
            Capability::Canvas,
            Capability::NodesRead,
            Capability::NetServer
        ])
    );
    assert_eq!(
        require_capability(&effective, Capability::ChatSend),
        Err(AppsRefusal::Ungranted(Capability::ChatSend))
    );
    assert_eq!(
        require_capability(&effective, Capability::NodesRead),
        Ok(())
    );
    let chatter = holds(perms(&[Permission::ViewContent, Permission::SendMessages]));
    assert!(effective_capabilities(&granted, &installer, &chatter, true)
        .contains(&Capability::ChatSend));
    assert!(
        effective_capabilities(&granted, &installer, &chatter, false).is_empty(),
        "outside the scope's reach"
    );
    let ungranted =
        effective_capabilities(&caps(&[Capability::Canvas]), &installer, &chatter, true);
    assert!(
        !ungranted.contains(&Capability::ChatSend),
        "never more than the install was granted"
    );
}

#[test]
fn demoting_the_installer_shrinks_what_their_installs_can_do() {
    let granted = caps(&[
        Capability::Canvas,
        Capability::NodesRead,
        Capability::NetServer,
    ]);
    let viewer = holds(perms(&[Permission::ViewContent]));
    let before = holds(perms(&[
        Permission::AppInstall,
        Permission::AppInstallAllowNodeRead,
        Permission::AppInstallAllowServerNetwork,
    ]));
    assert_eq!(
        effective_capabilities(&granted, &before, &viewer, true),
        granted
    );
    let demoted = holds(perms(&[Permission::AppInstall]));
    assert_eq!(
        effective_capabilities(&granted, &demoted, &viewer, true),
        caps(&[Capability::Canvas])
    );
    let removed = holds(perms(&[]));
    assert!(effective_capabilities(&granted, &removed, &viewer, true).is_empty());
}
