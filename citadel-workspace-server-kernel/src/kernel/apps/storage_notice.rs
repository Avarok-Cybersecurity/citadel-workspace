//! Who is told that an app wrote to a node's storage (`AppEvent::StorageChanged`'s producer,
//! Calendar design §3.3.1), pure.
//!
//! A write to `storage.node` or `storage.node.authored` is announced to the sessions that may view
//! the node, naming the install, the store and the keys and never a value; their pages pass it to
//! that install's running instances, which read the keys again with their own rights. One session
//! serves every tab and instance in a browser, so the writer's session is told too.
//!
//! Only an install whose reach is the node's viewers is announced: a workspace-, node- or
//! tree-scoped one. A users- or self-scoped install reaches a list of members, which the node's
//! viewers are not, so announcing its writes would tell them about an install they do not run.
//! User and scope stores are not announced in this release.

use super::storage::Namespace;
use citadel_app_sdk_types::calls::StorageBackend;
use citadel_workspace_types::apps::InstallScope;

/// What to announce, and on which node, after a write to `namespace` by an install at `scope`.
pub fn storage_notice(
    scope: &InstallScope,
    namespace: &Namespace,
) -> Option<(String, StorageBackend)> {
    let reaches_viewers = matches!(
        scope,
        InstallScope::Workspace | InstallScope::Node(_) | InstallScope::NodeTree(_)
    );
    if !reaches_viewers {
        return None;
    }
    match namespace {
        Namespace::Node(node) => Some((
            node.clone(),
            StorageBackend::Node {
                node_id: node.clone(),
            },
        )),
        Namespace::NodeAuthored { node, author } => Some((
            node.clone(),
            StorageBackend::NodeAuthored {
                node_id: node.clone(),
                author: author.clone(),
            },
        )),
        Namespace::User(_) | Namespace::Scope => None,
    }
}
