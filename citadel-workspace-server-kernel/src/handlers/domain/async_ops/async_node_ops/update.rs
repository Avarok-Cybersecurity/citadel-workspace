//! `update_node`: an edit gated on what it changes, at the node it changes.

use super::current_timestamp;
use crate::handlers::domain::async_ops::node_chat::set_chat_enabled;
use crate::handlers::domain::async_ops::node_views::with_live_child_types;
use crate::handlers::domain::async_ops::AsyncPermissionOperations;
use crate::handlers::domain::server_ops::async_domain_server_ops::AsyncDomainServerOperations;
use citadel_sdk::prelude::{NetworkError, Ratchet};
use citadel_workspace_types::structs::{DomainNode, Permission};

impl<R: Ratchet + Send + Sync + 'static> AsyncDomainServerOperations<R> {
    #[allow(clippy::too_many_arguments)]
    pub(super) async fn update_node_impl(
        &self,
        user_id: &str,
        node_id: &str,
        name: Option<&str>,
        description: Option<&str>,
        mdx_content: Option<&str>,
        rules: Option<&str>,
        chat_enabled: Option<bool>,
        is_default: Option<bool>,
    ) -> Result<DomainNode, NetworkError> {
        // Gate on what is actually being changed, at the node being changed.
        //
        // Every update required EditTreeStructure at WORKSPACE_ROOT_ID, so
        // saving a document — which changes no structure at all — was refused
        // unless the user could restructure the entire workspace. That is not a
        // permission any custom role receives: `Permission::for_role` never
        // inserts EditTreeStructure for Custom, while EditMdx is directly
        // grantable in the permission matrix. So an admin could grant exactly
        // the persona ("can edit MDX documents") whose every save was refused,
        // while the UI — which gates its Edit button on EditMdx — correctly
        // enabled it. The two ends disagreed about which permission the feature
        // needs.
        //
        // Scoped to `node_id` rather than the root because
        // check_entity_permission walks UP the parent chain, so a grant at the
        // root still covers every descendant: node-scoped is strictly more
        // precise here, never less permissive.
        // One list, shared with the broadcast decision in the command processor.
        // They were separate copies and drifted -- see `update_changes_structure`.
        let changes_structure = crate::handlers::domain::node_ops::update_changes_structure(
            name,
            description,
            rules,
            chat_enabled,
            is_default,
        );

        let (required, label) = if changes_structure {
            (Permission::EditTreeStructure, "EditTreeStructure")
        } else {
            (Permission::EditMdx, "EditMdx")
        };

        if !self
            .check_entity_permission(user_id, node_id, required)
            .await?
        {
            return Err(NetworkError::msg(format!(
                "Permission denied: {label} required"
            )));
        }

        // A document's required-apps header is the kernel's to write (`kernel::apps::md_header`):
        // without AppManage on the node, an edit must carry the stored header byte for byte.
        // Asked before the lock, as the permission walk reads the node map itself.
        let may_manage_apps_header = match mdx_content {
            Some(_) => {
                self.check_entity_permission(user_id, node_id, Permission::AppManage)
                    .await?
            }
            None => false,
        };

        // Hold the nodes lock across the READ and the WRITE, as create, delete and
        // move already do. The backend's `update_node` does take this mutex, so
        // the write alone was safe — but the read below it was not, and the gap
        // between them spans our own awaits. Two callers editing the same node
        // both read the original and both write: the first one's field silently
        // reverts. Worse, a delete landing in that gap is undone, because the
        // write re-inserts the node the other caller just removed.
        //
        // tokio's Mutex is not reentrant, so calling the backend's `update_node`
        // while holding the guard would deadlock. Mutate the map already held and
        // persist it with `save_nodes`.
        let _nodes_guard = self.backend_tx_manager.lock_nodes().await;
        let mut nodes = self.backend_tx_manager.get_all_nodes().await?;

        let mut node = nodes
            .get(node_id)
            .cloned()
            .ok_or_else(|| NetworkError::msg(format!("Node '{}' not found", node_id)))?;

        // Apply updates
        if let Some(new_name) = name {
            node.name = String::from(new_name);
        }
        if let Some(new_desc) = description {
            node.description = String::from(new_desc);
        }
        if let Some(new_mdx) = mdx_content {
            crate::kernel::apps::md_header::check_header_edit(
                &node.mdx_content,
                new_mdx,
                may_manage_apps_header,
            )
            .map_err(NetworkError::msg)?;
            node.mdx_content = String::from(new_mdx);
            // Hashed HERE, where the content is stored, and nowhere else. The
            // client re-hashes before it executes the document and refuses on a
            // mismatch, so a document altered between this write and that
            // execution does not run. Computed from the value just assigned
            // rather than from `new_mdx`, so the two can never disagree.
            node.mdx_content_hash = Some(citadel_workspace_types::structs::mdx_content_hash(
                &node.mdx_content,
            ));
        }
        if let Some(new_rules) = rules {
            node.rules = Some(String::from(new_rules));
        }
        if let Some(new_chat_enabled) = chat_enabled {
            set_chat_enabled(&mut node, new_chat_enabled);
        }

        // Exactly one default, so setting it clears the others. Done inside the
        // same lock and the same save as the node's own change: a client that
        // saw one write succeed and the other fail would show two defaults, or
        // none, with no way to tell which.
        //
        // Only on `Some(true)` -- `Some(false)` clears this node's flag and
        // leaves the workspace with no default, which is a legitimate thing to
        // ask for and must not silently promote something else.
        if is_default == Some(true) {
            for (id, other) in nodes.iter_mut() {
                if id != node_id {
                    other.is_default = false;
                }
            }
        }
        if let Some(new_default) = is_default {
            node.is_default = new_default;
        }

        node.updated_at = current_timestamp();

        // Persist through the map we hold, not the backend mutator (see above).
        nodes.insert(String::from(node_id), node.clone());
        self.backend_tx_manager.save_nodes(&nodes).await?;

        let schema = self.backend_tx_manager.get_tree_schema_or_default().await?;
        Ok(with_live_child_types(node, &schema))
    }
}
