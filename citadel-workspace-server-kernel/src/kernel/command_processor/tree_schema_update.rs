//! Changing the workspace's hierarchy: UpdateTreeSchema and CreateNodeType.
//!
//! Both used to save whatever they were given, behind an admin check rather than the permission
//! the schema names. Both now go through `save_validated`, so there is one definition of a
//! schema the workspace can live in:
//! - it must pass `schema_rules::validate_schema`, and its `max_depth` is derived from its rules;
//! - it may not strand an existing node where the new rules do not allow it. Only the nodes it
//!   would newly strand are counted, so a tree already out of step with its schema, from before
//!   validation existed, can still be repaired by a later save;
//! - it reaches every member at once, so open sidebars and create dialogs relabel without a
//!   reload.

use crate::handlers::domain::async_ops::AsyncPermissionOperations;
use crate::handlers::domain::schema_rules::{
    nodes_outside, validate_schema, with_derived_children,
};
use crate::kernel::async_kernel::AsyncWorkspaceServerKernel;
use crate::WorkspaceProtocolResponse;
use citadel_sdk::prelude::{NetworkError, Ratchet};
use citadel_workspace_types::structs::{
    CustomNodeType, DomainNode, EntityTypeConfig, NestingRule, Permission, TreeSchema,
};

async fn may_manage_levels<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    actor_user_id: &str,
) -> bool {
    kernel
        .domain_operations
        .check_entity_permission(
            actor_user_id,
            crate::WORKSPACE_ROOT_ID,
            Permission::ManageNodeTypes,
        )
        .await
        .unwrap_or(false)
}

const DENIED: &str = "Permission denied: ManageNodeTypes required";
/// A level created without an icon: CreateNodeType's `icon` is optional on the wire.
const ICON_WHEN_NONE_CHOSEN: &str = "folder";

/// Validate `next` against the rules and the existing tree, then save and announce it.
/// The caller holds the node lock, so no node is created between the check and the save.
async fn save_validated<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    requester_cid: Option<u64>,
    current: &TreeSchema,
    mut next: TreeSchema,
) -> Result<Result<TreeSchema, String>, NetworkError> {
    let depth = match validate_schema(&next) {
        Ok(depth) => depth,
        Err(problems) => {
            let list: Vec<String> = problems.iter().map(ToString::to_string).collect();
            return Ok(Err(format!(
                "This hierarchy cannot be saved: {}",
                list.join("; ")
            )));
        }
    };
    next.max_depth = Some(depth);

    let backend = &kernel.domain_operations.backend_tx_manager;
    let nodes = backend.get_all_nodes().await?;
    let already = nodes_outside(&nodes, current);
    let stranded: Vec<String> = nodes_outside(&nodes, &next)
        .difference(&already)
        .filter_map(|id| nodes.get(id).map(|n| format!("\"{}\"", n.name)))
        .collect();
    if !stranded.is_empty() {
        return Ok(Err(format!(
            "This hierarchy would leave {} where it no longer allows them: {}. Move or delete them first.",
            if stranded.len() == 1 { "1 item" } else { "these items" },
            stranded.join(", ")
        )));
    }

    backend.save_tree_schema(&next).await?;
    kernel.broadcast_to_workspace(
        WorkspaceProtocolResponse::TreeSchema(next.clone()),
        requester_cid,
        crate::WORKSPACE_ROOT_ID.to_string(),
    );
    Ok(Ok(next))
}

pub(super) async fn update_tree_schema<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    actor_user_id: &str,
    requester_cid: Option<u64>,
    proposed: &TreeSchema,
) -> Result<WorkspaceProtocolResponse, NetworkError> {
    if !may_manage_levels(kernel, actor_user_id).await {
        return Ok(WorkspaceProtocolResponse::Error(DENIED.to_string()));
    }
    let backend = &kernel.domain_operations.backend_tx_manager;
    let _nodes_guard = backend.lock_nodes().await;
    let current = backend.get_tree_schema_or_default().await?;
    Ok(
        match save_validated(kernel, requester_cid, &current, proposed.clone()).await? {
            Ok(saved) => WorkspaceProtocolResponse::TreeSchema(saved),
            Err(reason) => WorkspaceProtocolResponse::Error(reason),
        },
    )
}

/// A new level: nesting rules under each allowed parent, and a display config so it has a label.
/// It used to add only the rules, so the new level had no label, icon or placeholders.
pub(super) async fn create_node_type<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    actor_user_id: &str,
    requester_cid: Option<u64>,
    node_type: CustomNodeType,
) -> Result<WorkspaceProtocolResponse, NetworkError> {
    if !may_manage_levels(kernel, actor_user_id).await {
        return Ok(WorkspaceProtocolResponse::Error(DENIED.to_string()));
    }
    let backend = &kernel.domain_operations.backend_tx_manager;
    let _nodes_guard = backend.lock_nodes().await;
    let current = backend.get_tree_schema_or_default().await?;

    let mut next = current.clone();
    for parent in &node_type.allowed_parents {
        match next.rules.iter_mut().find(|r| &r.parent_type == parent) {
            Some(rule) if !rule.allowed_child_types.contains(&node_type.name) => {
                rule.allowed_child_types.push(node_type.name.clone())
            }
            Some(_) => {}
            None => next.rules.push(NestingRule {
                parent_type: parent.clone(),
                allowed_child_types: vec![node_type.name.clone()],
            }),
        }
    }
    if !next
        .entity_type_configs
        .iter()
        .any(|c| c.type_name == node_type.name)
    {
        next.entity_type_configs.push(EntityTypeConfig {
            type_name: node_type.name.clone(),
            icon: node_type
                .icon
                .clone()
                .unwrap_or_else(|| ICON_WHEN_NONE_CHOSEN.to_string()),
            label: node_type.display_name.clone(),
            plural_label: format!("{}s", node_type.display_name),
            name_placeholder: String::new(),
            description_placeholder: String::new(),
            chat_default: true,
        });
    }

    Ok(
        match save_validated(kernel, requester_cid, &current, next).await? {
            Ok(_) => WorkspaceProtocolResponse::NodeTypes(vec![node_type]),
            Err(reason) => WorkspaceProtocolResponse::Error(reason),
        },
    )
}

/// `node` as it is sent out: with the child levels the current schema allows it.
pub(super) async fn with_current_children<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    node: DomainNode,
) -> Result<DomainNode, NetworkError> {
    let schema = kernel
        .domain_operations
        .backend_tx_manager
        .get_tree_schema_or_default()
        .await?;
    Ok(with_derived_children(node, &schema))
}
