//! Audience and scope reach, each refusal beside the install that is allowed.

use super::audience::{audience_admits, scope_reach_within_audience, scope_reaches};
use super::test_facts::Facts;
use citadel_workspace_types::apps::{AppAudience, InstallScope};
use citadel_workspace_types::apps_install::AppsRefusal;

fn names(list: &[&str]) -> Vec<String> {
    list.iter().map(|n| n.to_string()).collect()
}

fn within(scope: InstallScope, audience: AppAudience) -> Result<(), AppsRefusal> {
    let facts = Facts::sample();
    scope_reach_within_audience(&scope, &audience, &facts.members, &facts)
}

#[test]
fn each_audience_admits_whom_it_names_and_never_a_non_member() {
    let facts = Facts::sample();
    let admits = |audience: &AppAudience, user| audience_admits(audience, user, &facts);
    for audience in [AppAudience::Global {}, AppAudience::Workspace {}] {
        assert!(["alice", "bob", "carol"]
            .iter()
            .all(|u| admits(&audience, u)));
        assert!(!admits(&audience, "dave"), "a non-member");
    }
    let office = AppAudience::NodeViewers {
        node_id: "office".into(),
    };
    assert!(admits(&office, "alice") && admits(&office, "bob") && !admits(&office, "carol"));
    let office_tree = AppAudience::NodeTreeViewers {
        node_id: "office".into(),
    };
    assert!(
        admits(&office_tree, "carol"),
        "carol views the room below the office"
    );
    let members = AppAudience::Members {
        usernames: names(&["bob", "dave"]),
    };
    assert!(admits(&members, "bob") && !admits(&members, "alice"));
    assert!(!admits(&members, "dave"), "named, but not a member");
    let guests = AppAudience::Roles {
        role_ids: names(&["guest"]),
    };
    assert!(admits(&guests, "carol") && !admits(&guests, "alice"));
}

#[test]
fn each_scope_reaches_whom_it_covers() {
    let facts = Facts::sample();
    let reaches = |scope: &InstallScope, user| scope_reaches(scope, user, &facts);
    assert!(reaches(&InstallScope::Workspace, "carol"));
    assert!(!reaches(&InstallScope::Workspace, "dave"));
    assert!(!reaches(&InstallScope::Node("office".into()), "carol"));
    assert!(reaches(&InstallScope::NodeTree("office".into()), "carol"));
    assert!(reaches(&InstallScope::SelfOnly("bob".into()), "bob"));
    assert!(!reaches(&InstallScope::SelfOnly("bob".into()), "alice"));
}

#[test]
fn a_workspace_install_of_an_app_for_two_members_is_refused_and_one_for_one_of_them_is_not() {
    let audience = AppAudience::Members {
        usernames: names(&["alice", "bob"]),
    };
    assert_eq!(
        within(InstallScope::Workspace, audience.clone()),
        Err(AppsRefusal::ScopeOutsideAudience)
    );
    assert_eq!(
        within(InstallScope::Users(names(&["alice"])), audience.clone()),
        Ok(())
    );
    assert_eq!(
        within(
            InstallScope::Users(names(&["alice", "bob"])),
            audience.clone()
        ),
        Ok(())
    );
    assert_eq!(
        within(InstallScope::SelfOnly("bob".into()), audience.clone()),
        Ok(())
    );
    assert_eq!(
        within(InstallScope::Users(names(&["alice", "carol"])), audience),
        Err(AppsRefusal::ScopeOutsideAudience)
    );
}

#[test]
fn a_node_scope_must_stay_inside_a_node_audience() {
    let office = AppAudience::NodeViewers {
        node_id: "office".into(),
    };
    // The office's viewers (alice, bob) are the audience: an office install is inside it.
    assert_eq!(
        within(InstallScope::Node("office".into()), office.clone()),
        Ok(())
    );
    // The office tree also reaches carol, who views only the room.
    assert_eq!(
        within(InstallScope::NodeTree("office".into()), office.clone()),
        Err(AppsRefusal::ScopeOutsideAudience)
    );
    assert_eq!(
        within(InstallScope::Workspace, office),
        Err(AppsRefusal::ScopeOutsideAudience)
    );
    let tree = AppAudience::NodeTreeViewers {
        node_id: "office".into(),
    };
    assert_eq!(
        within(InstallScope::NodeTree("office".into()), tree),
        Ok(())
    );
}

#[test]
fn a_global_or_workspace_audience_admits_every_scope() {
    for audience in [AppAudience::Global {}, AppAudience::Workspace {}] {
        for scope in [
            InstallScope::Workspace,
            InstallScope::Node("room".into()),
            InstallScope::NodeTree("root".into()),
            InstallScope::Users(names(&["alice", "carol"])),
            InstallScope::SelfOnly("carol".into()),
        ] {
            assert_eq!(within(scope.clone(), audience.clone()), Ok(()), "{scope:?}");
        }
    }
}

#[test]
fn a_scope_naming_a_non_member_is_refused_even_for_a_global_app() {
    let global = AppAudience::Global {};
    assert_eq!(
        within(
            InstallScope::Users(names(&["alice", "dave"])),
            global.clone()
        ),
        Err(AppsRefusal::ScopeOutsideAudience)
    );
    assert_eq!(
        within(InstallScope::SelfOnly("dave".into()), global),
        Err(AppsRefusal::ScopeOutsideAudience)
    );
}

#[test]
fn a_role_audience_refuses_a_scope_reaching_other_roles() {
    let guests = AppAudience::Roles {
        role_ids: names(&["guest"]),
    };
    assert_eq!(
        within(InstallScope::Node("room".into()), guests.clone()),
        Err(AppsRefusal::ScopeOutsideAudience)
    );
    assert_eq!(
        within(InstallScope::SelfOnly("carol".into()), guests),
        Ok(())
    );
}
