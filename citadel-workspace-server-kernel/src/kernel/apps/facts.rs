//! The facts a decision reads, gathered by the request handler before it decides.
//!
//! The rules are pure and synchronous; permissions and node views are async reads. The handler
//! reads every fact a decision can ask for into these, and the decision reads only them. A
//! question nobody gathered an answer to is answered no: a missed read refuses, never admits.

use super::audience::AudienceFacts;
use citadel_workspace_types::apps::{AppAudience, InstallScope};
use citadel_workspace_types::structs::Permission;
use std::collections::{BTreeSet, HashMap, HashSet};

/// The permissions one member holds on one node, every variant asked, each with the walk up the
/// tree, the node grants and the role that `check_entity_permission` makes.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct PermissionSnapshot {
    held: HashSet<Permission>,
}

impl PermissionSnapshot {
    pub fn of(held: impl IntoIterator<Item = Permission>) -> Self {
        Self {
            held: held.into_iter().collect(),
        }
    }

    pub fn holds(&self, permission: Permission) -> bool {
        self.held.contains(&permission)
    }
}

/// Who is a member, their roles, and who views which node and tree.
#[derive(Debug, Clone, Default)]
pub struct GatheredFacts {
    /// Members who are not banned.
    pub members: Vec<String>,
    pub roles: HashMap<String, String>,
    /// `(username, node id)` pairs holding `ViewContent` on the node.
    pub node_views: HashSet<(String, String)>,
    /// `(username, node id)` pairs holding `ViewContent` on the node or one below it.
    pub tree_views: HashSet<(String, String)>,
}

impl AudienceFacts for GatheredFacts {
    fn is_member(&self, username: &str) -> bool {
        self.members.iter().any(|m| m == username)
    }
    fn role_of(&self, username: &str) -> Option<String> {
        self.roles.get(username).cloned()
    }
    fn views_node(&self, username: &str, node_id: &str) -> bool {
        self.node_views
            .contains(&(username.to_string(), node_id.to_string()))
    }
    fn views_tree(&self, username: &str, node_id: &str) -> bool {
        self.tree_views
            .contains(&(username.to_string(), node_id.to_string()))
    }
}

/// Which node and tree views a decision about these audiences and scopes can ask for.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ViewsNeeded {
    pub nodes: BTreeSet<String>,
    pub trees: BTreeSet<String>,
}

impl ViewsNeeded {
    pub fn audience(&mut self, audience: &AppAudience) -> &mut Self {
        match audience {
            AppAudience::NodeViewers { node_id } => {
                self.nodes.insert(node_id.clone());
            }
            AppAudience::NodeTreeViewers { node_id } => {
                self.trees.insert(node_id.clone());
            }
            _ => {}
        }
        self
    }

    pub fn scope(&mut self, scope: &InstallScope) -> &mut Self {
        match scope {
            InstallScope::Node(node_id) => {
                self.nodes.insert(node_id.clone());
            }
            InstallScope::NodeTree(node_id) => {
                self.trees.insert(node_id.clone());
            }
            _ => {}
        }
        self
    }
}

/// The node an install's authority is checked on: the scope's node, whose ancestors' grants
/// count, or the workspace root for a scope that names no node. The runtime's call-time checks
/// of the installer read the same node.
pub fn authority_node<'a>(scope: &'a InstallScope, root: &'a str) -> &'a str {
    match scope {
        InstallScope::Node(node_id) | InstallScope::NodeTree(node_id) => node_id,
        InstallScope::Workspace | InstallScope::Users(_) | InstallScope::SelfOnly(_) => root,
    }
}
