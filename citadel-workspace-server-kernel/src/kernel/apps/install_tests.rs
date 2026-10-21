//! Who may install where, and the apps actions' fixed permissions.

use super::rules::*;
use super::test_facts::{holds, perms};
use citadel_workspace_types::apps::{InstallScope, ScopeKind};
use citadel_workspace_types::apps_install::AppsRefusal;
use citadel_workspace_types::roles::owner_permissions;
use citadel_workspace_types::structs::Permission;

#[test]
fn installing_for_oneself_takes_app_install_and_for_others_app_install_scoped() {
    let all = [
        ScopeKind::Workspace,
        ScopeKind::Node,
        ScopeKind::NodeTree,
        ScopeKind::Users,
        ScopeKind::SelfOnly,
    ];
    let member = holds(perms(&[Permission::AppInstall]));
    let mine = InstallScope::SelfOnly("alice".into());
    assert_eq!(may_install_at(&mine, &all, "alice", &member), Ok(()));
    for scope in [
        InstallScope::Workspace,
        InstallScope::Node("n".into()),
        InstallScope::Users(vec!["alice".into()]),
        InstallScope::SelfOnly("bob".into()),
    ] {
        assert_eq!(
            may_install_at(&scope, &all, "alice", &member),
            Err(AppsRefusal::PermissionRequired(
                Permission::AppInstallScoped
            )),
            "{scope:?}"
        );
        assert_eq!(
            may_install_at(
                &scope,
                &all,
                "alice",
                &holds(perms(&[Permission::AppInstallScoped]))
            ),
            Ok(())
        );
    }
    assert_eq!(
        may_install_at(&mine, &[ScopeKind::Workspace], "alice", &member),
        Err(AppsRefusal::ScopeNotSupported)
    );
    assert_eq!(
        may_install_at(
            &InstallScope::Node("a/b".into()),
            &all,
            "alice",
            &holds(owner_permissions())
        ),
        Err(AppsRefusal::ScopeNotSupported)
    );
}

#[test]
fn the_fixed_actions_name_their_permissions() {
    assert_eq!(
        action_permissions(AppsAction::Publish),
        [Permission::AppPublish]
    );
    assert_eq!(
        action_permissions(AppsAction::Manage),
        [Permission::AppManage]
    );
    assert_eq!(
        action_permissions(AppsAction::WriteMdHeader),
        [Permission::AppManage, Permission::EditMdx]
    );
}
