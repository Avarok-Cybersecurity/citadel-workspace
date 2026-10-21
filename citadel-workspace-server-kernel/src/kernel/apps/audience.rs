//! Who an app's audience admits, who an install's scope reaches, and whether the second stays
//! inside the first.
//!
//! Audience is who may see and be given an app; scope is where an install runs. An install is
//! refused unless everyone its scope reaches is in the app's audience: a `Workspace` install of
//! an app for `Members([alice, bob])` would run it for everyone else too.

use citadel_workspace_types::apps::{AppAudience, InstallScope};
use citadel_workspace_types::apps_install::AppsRefusal;

/// What the server knows about the people in question. The handler implements it over the
/// workspace's members, role table and node grants (a grant on a level above counts).
pub trait AudienceFacts {
    /// A member of the workspace who is not banned. Nobody else is admitted by any audience or
    /// reached by any scope.
    fn is_member(&self, username: &str) -> bool;
    fn role_of(&self, username: &str) -> Option<String>;
    /// `ViewContent` on the node.
    fn views_node(&self, username: &str, node_id: &str) -> bool;
    /// `ViewContent` on the node or on any node below it.
    fn views_tree(&self, username: &str, node_id: &str) -> bool;
}

/// Whether `audience` admits `username`.
pub fn audience_admits(audience: &AppAudience, username: &str, facts: &dyn AudienceFacts) -> bool {
    if !facts.is_member(username) {
        return false;
    }
    match audience {
        AppAudience::Global {} | AppAudience::Workspace {} => true,
        AppAudience::NodeViewers { node_id } => facts.views_node(username, node_id),
        AppAudience::NodeTreeViewers { node_id } => facts.views_tree(username, node_id),
        AppAudience::Members { usernames } => usernames.iter().any(|u| u == username),
        AppAudience::Roles { role_ids } => facts
            .role_of(username)
            .is_some_and(|role| role_ids.contains(&role)),
    }
}

/// Whether an install at `scope` runs for `username`.
pub fn scope_reaches(scope: &InstallScope, username: &str, facts: &dyn AudienceFacts) -> bool {
    if !facts.is_member(username) {
        return false;
    }
    match scope {
        InstallScope::Workspace => true,
        InstallScope::Node(node_id) => facts.views_node(username, node_id),
        InstallScope::NodeTree(node_id) => facts.views_tree(username, node_id),
        InstallScope::Users(usernames) => usernames.iter().any(|u| u == username),
        InstallScope::SelfOnly(user) => user == username,
    }
}

/// `Ok` only when everyone `scope` reaches is in `audience`. `members` is every member of the
/// workspace; a `Users` or `SelfOnly` scope naming anyone who is not one is refused outright.
pub fn scope_reach_within_audience(
    scope: &InstallScope,
    audience: &AppAudience,
    members: &[String],
    facts: &dyn AudienceFacts,
) -> Result<(), AppsRefusal> {
    let named: &[String] = match scope {
        InstallScope::Users(usernames) => usernames,
        InstallScope::SelfOnly(user) => std::slice::from_ref(user),
        _ => &[],
    };
    if named.iter().any(|user| !facts.is_member(user)) {
        return Err(AppsRefusal::ScopeOutsideAudience);
    }
    let reached = members
        .iter()
        .chain(named)
        .filter(|user| scope_reaches(scope, user, facts));
    for user in reached {
        if !audience_admits(audience, user, facts) {
            return Err(AppsRefusal::ScopeOutsideAudience);
        }
    }
    Ok(())
}
