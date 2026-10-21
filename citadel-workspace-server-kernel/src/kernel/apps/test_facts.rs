//! A workspace for the apps rules' tests: members, their roles, and which nodes they view.

use super::audience::AudienceFacts;
use citadel_workspace_types::apps::Capability;
use citadel_workspace_types::structs::Permission;
use std::collections::{BTreeSet, HashMap, HashSet};

/// The tree is `root > office > room`; a view of a node implies its descendants, as grants
/// inherit downwards.
pub(crate) struct Facts {
    pub members: Vec<String>,
    pub roles: HashMap<String, String>,
    /// Nodes each member holds `ViewContent` on directly.
    pub grants: HashMap<String, HashSet<String>>,
}

const PARENT: [(&str, &str); 2] = [("office", "root"), ("room", "office")];

fn ancestors_and_self(node: &str) -> Vec<String> {
    let mut chain = vec![node.to_string()];
    let mut at = node;
    while let Some((_, parent)) = PARENT.iter().find(|(child, _)| *child == at) {
        chain.push(parent.to_string());
        at = parent;
    }
    chain
}

impl Facts {
    /// alice: member role, views the whole workspace. bob: member role, views the office.
    /// carol: guest role, views only the room. dave: not a member.
    pub fn sample() -> Self {
        let grant = |nodes: &[&str]| nodes.iter().map(|n| n.to_string()).collect::<HashSet<_>>();
        Self {
            members: ["alice", "bob", "carol"].map(String::from).to_vec(),
            roles: [("alice", "member"), ("bob", "member"), ("carol", "guest")]
                .map(|(u, r)| (u.to_string(), r.to_string()))
                .into(),
            grants: [
                ("alice", grant(&["root"])),
                ("bob", grant(&["office"])),
                ("carol", grant(&["room"])),
            ]
            .map(|(u, g)| (u.to_string(), g))
            .into(),
        }
    }
}

impl AudienceFacts for Facts {
    fn is_member(&self, username: &str) -> bool {
        self.members.iter().any(|m| m == username)
    }
    fn role_of(&self, username: &str) -> Option<String> {
        self.roles.get(username).cloned()
    }
    fn views_node(&self, username: &str, node_id: &str) -> bool {
        let held = self.grants.get(username);
        ancestors_and_self(node_id)
            .iter()
            .any(|n| held.is_some_and(|g| g.contains(n)))
    }
    fn views_tree(&self, username: &str, node_id: &str) -> bool {
        let below: Vec<&str> = PARENT
            .iter()
            .filter(|(child, _)| ancestors_and_self(child).iter().any(|a| a == node_id))
            .map(|(child, _)| *child)
            .collect();
        self.views_node(username, node_id) || below.iter().any(|n| self.views_node(username, n))
    }
}

/// A permission predicate over `set`, honouring `All`, as the handler builds one.
pub(crate) fn holds(set: HashSet<Permission>) -> impl Fn(Permission) -> bool {
    move |p| Permission::has_permission(&set, &p)
}

pub(crate) fn perms(list: &[Permission]) -> HashSet<Permission> {
    list.iter().copied().collect()
}

pub(crate) fn caps(list: &[Capability]) -> BTreeSet<Capability> {
    list.iter().copied().collect()
}
