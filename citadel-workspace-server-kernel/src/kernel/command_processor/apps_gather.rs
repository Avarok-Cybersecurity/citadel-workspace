//! The reads the apps decisions need, made before they decide: permission snapshots, members,
//! roles, and who views which node and tree. Every permission is asked through
//! `check_entity_permission`, so a node grant, an ancestor's grant and the role count exactly as
//! everywhere else.

use crate::handlers::domain::async_ops::AsyncPermissionOperations;
use crate::kernel::apps::audience::scope_reaches;
use crate::kernel::apps::facts::{authority_node, GatheredFacts, PermissionSnapshot, ViewsNeeded};
use crate::kernel::apps::peer_rules::with_consent;
use crate::kernel::apps::rules::effective_capabilities;
use crate::kernel::async_kernel::AsyncWorkspaceServerKernel;
use crate::WORKSPACE_ROOT_ID;
use citadel_sdk::prelude::{NetworkError, Ratchet};
use citadel_workspace_types::apps::Capability;
use citadel_workspace_types::apps_install::AppInstall;
use citadel_workspace_types::structs::{DomainNode, Permission};
use std::collections::{BTreeSet, HashMap, HashSet};

/// Every permission `user` holds on `node`.
pub(super) async fn snapshot<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    user: &str,
    node: &str,
) -> Result<PermissionSnapshot, NetworkError> {
    let ops = &kernel.domain_operations;
    let mut held = Vec::new();
    for permission in Permission::ALL_VARIANTS {
        if ops.check_entity_permission(user, node, permission).await? {
            held.push(permission);
        }
    }
    Ok(PermissionSnapshot::of(held))
}

pub(super) async fn holds_at<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    user: &str,
    node: &str,
    permission: Permission,
) -> Result<bool, NetworkError> {
    kernel
        .domain_operations
        .check_entity_permission(user, node, permission)
        .await
}

pub(super) async fn node_exists<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    node_id: &str,
) -> Result<bool, NetworkError> {
    let backend = &kernel.domain_operations.backend_tx_manager;
    Ok(backend.get_all_nodes_shared().await?.contains_key(node_id))
}

/// The workspace's members who are not banned.
pub(super) async fn members<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
) -> Result<Vec<String>, NetworkError> {
    let backend = &kernel.domain_operations.backend_tx_manager;
    let Some(workspace) = backend.get_workspace(WORKSPACE_ROOT_ID).await? else {
        return Ok(Vec::new());
    };
    let mut members = Vec::new();
    for id in workspace.members {
        if backend.get_user(&id).await?.is_some_and(|u| !u.is_banned()) {
            members.push(id);
        }
    }
    Ok(members)
}

/// `node_id` and every node below it.
pub(super) fn subtree(nodes: &HashMap<String, DomainNode>, node_id: &str) -> Vec<String> {
    let mut seen: HashSet<String> = HashSet::new();
    let mut queue = vec![node_id.to_string()];
    while let Some(at) = queue.pop() {
        if !seen.insert(at.clone()) {
            continue;
        }
        queue.extend(
            nodes
                .values()
                .filter(|n| n.parent_id.as_deref() == Some(at.as_str()))
                .map(|n| n.id.clone()),
        );
    }
    seen.into_iter().collect()
}

/// The facts about `users` that decisions over `needed` read. Only members are asked about;
/// anyone else is no one's audience and in no one's scope.
pub(super) async fn gather<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    users: &[String],
    needed: &ViewsNeeded,
) -> Result<GatheredFacts, NetworkError> {
    let backend = &kernel.domain_operations.backend_tx_manager;
    let all_members = members(kernel).await?;
    let asked: BTreeSet<&String> = users.iter().filter(|u| all_members.contains(u)).collect();
    let nodes = backend.get_all_nodes_shared().await?;
    let mut facts = GatheredFacts {
        members: all_members.clone(),
        ..GatheredFacts::default()
    };
    for user in asked {
        if let Some(record) = backend.get_user(user).await? {
            if let Some(role) = record.role_id_in(WORKSPACE_ROOT_ID) {
                facts.roles.insert(user.clone(), role.to_string());
            }
        }
        for node in &needed.nodes {
            if holds_at(kernel, user, node, Permission::ViewContent).await? {
                facts.node_views.insert((user.clone(), node.clone()));
            }
        }
        for tree in &needed.trees {
            for node in subtree(&nodes, tree) {
                if holds_at(kernel, user, &node, Permission::ViewContent).await? {
                    facts.tree_views.insert((user.clone(), tree.clone()));
                    break;
                }
            }
        }
    }
    Ok(facts)
}

/// What `install` may do now for `acting_user`: its grant, narrowed to what its installer may
/// still grant on the scope's node, what the acting member holds on `target`, nothing when the
/// install does not reach the acting member, and no P2P or topic capability the member did not
/// allow for themselves. Read at the time of the call, so a role change
/// applies at the next one. The runtime's `Call` handler asks this.
pub async fn effective_for<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    install: &AppInstall,
    acting_user: &str,
    target: &str,
) -> Result<BTreeSet<Capability>, NetworkError> {
    let authority = authority_node(&install.scope, WORKSPACE_ROOT_ID);
    let installer = snapshot(kernel, &install.installed_by, authority).await?;
    let acting = snapshot(kernel, acting_user, target).await?;
    let mut needed = ViewsNeeded::default();
    needed.scope(&install.scope);
    let facts = gather(kernel, &[acting_user.to_string()], &needed).await?;
    let effective = effective_capabilities(
        &install.granted,
        &|p| installer.holds(p),
        &|p| acting.holds(p),
        scope_reaches(&install.scope, acting_user, &facts),
    );
    // The member's own say over the peer-to-peer and topic capabilities (F3).
    let mine = kernel
        .domain_operations
        .backend_tx_manager
        .user_apps(acting_user)
        .await?;
    Ok(with_consent(
        effective,
        &mine.consent(&install.id),
        mine.disabled.contains(&install.id),
    ))
}
