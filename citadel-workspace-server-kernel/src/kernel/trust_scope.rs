//! Who is within a trusted root, and the policies as stored.
//!
//! "Within a node" is the node's own list and the lists of every node below it. People who
//! reach the node only through a level above are not within it: access inherits downwards, so
//! counting them would put every workspace member inside every node, and a policy trusting one
//! branch would trust the whole workspace. At the workspace root the two readings agree, since
//! nothing is above it.
//!
//! Pure. The caller supplies the node map and the records; nothing here reads storage. A stored
//! policy that cannot be read is answered as `Strict`: the fail-closed direction, in which a
//! request is asked about rather than accepted.

use crate::handlers::domain::tree_validator::TreeValidator;
use citadel_workspace_types::messaging_trust::{
    MessagingTrustPolicy, DEFAULT_MESSAGING_TRUST_POLICY, MESSAGING_TRUST_POLICY_KEY,
};
use citadel_workspace_types::structs::{DomainNode, MetadataValue, User, UserRole};
use std::collections::HashMap;

/// `node` is `ancestor` or lies below it.
pub(crate) fn within(nodes: &HashMap<String, DomainNode>, node: &str, ancestor: &str) -> bool {
    node == ancestor
        || TreeValidator::get_path_to_root(nodes, node)
            .iter()
            .any(|id| id == ancestor)
}

/// Whether `user_id` is within `root`.
///
/// `root_members` is the list kept on the root's own record when that record is a workspace
/// rather than a node (the list `is_member_of_domain` enforces); empty otherwise.
pub(crate) fn in_subtree(
    nodes: &HashMap<String, DomainNode>,
    root: &str,
    root_members: &[String],
    user_id: &str,
) -> bool {
    root_members.iter().any(|member| member == user_id)
        || nodes.values().any(|node| {
            node.members.iter().any(|member| member == user_id) && within(nodes, &node.id, root)
        })
}

/// The workspace policy in `metadata`; the default when no policy was ever set.
pub(crate) fn workspace_policy(metadata: &[u8]) -> MessagingTrustPolicy {
    if metadata.is_empty() {
        return DEFAULT_MESSAGING_TRUST_POLICY;
    }
    let Ok(serde_json::Value::Object(document)) = serde_json::from_slice(metadata) else {
        return MessagingTrustPolicy::Strict;
    };
    match document.get(MESSAGING_TRUST_POLICY_KEY) {
        None => DEFAULT_MESSAGING_TRUST_POLICY,
        Some(value) => {
            serde_json::from_value(value.clone()).unwrap_or(MessagingTrustPolicy::Strict)
        }
    }
}

/// A member's own policy; `None` when they follow the workspace.
pub(crate) fn personal_policy(user: &User) -> Option<MessagingTrustPolicy> {
    match user.metadata.get(MESSAGING_TRUST_POLICY_KEY)? {
        MetadataValue::String(encoded) => {
            Some(serde_json::from_str(encoded).unwrap_or(MessagingTrustPolicy::Strict))
        }
        _ => Some(MessagingTrustPolicy::Strict),
    }
}

/// Store `policy` as `user`'s own; `None` follows the workspace.
pub(crate) fn set_personal_policy(
    user: &mut User,
    policy: Option<&MessagingTrustPolicy>,
) -> Result<(), String> {
    match policy {
        None => {
            user.metadata.remove(MESSAGING_TRUST_POLICY_KEY);
        }
        Some(policy) => {
            let encoded = serde_json::to_string(policy)
                .map_err(|e| format!("Failed to encode the policy: {e}"))?;
            user.metadata.insert(
                MESSAGING_TRUST_POLICY_KEY.to_string(),
                MetadataValue::String(encoded),
            );
        }
    }
    Ok(())
}

/// Whether `owner`'s client takes `other` without asking: both within `owner`'s effective root.
pub(crate) fn trusts(
    nodes: &HashMap<String, DomainNode>,
    workspace_policy: &MessagingTrustPolicy,
    workspace_id: &str,
    workspace_members: &[String],
    owner: &User,
    other: &User,
) -> bool {
    if owner.role == UserRole::Banned || other.role == UserRole::Banned {
        return false;
    }
    let personal = personal_policy(owner);
    let Some(root) = citadel_workspace_types::messaging_trust::effective_trusted_root(
        workspace_policy,
        personal.as_ref(),
        |node, ancestor| within(nodes, node, ancestor),
    ) else {
        return false;
    };
    let root_members: &[String] = if root == workspace_id {
        workspace_members
    } else {
        &[]
    };
    [owner, other]
        .iter()
        .all(|user| in_subtree(nodes, root, root_members, &user.id))
}
