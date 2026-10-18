//! `Resolve`: where a token points, for a caller its grants admit.
//!
//! Every refusal is the same `LinkUnavailable`, and the work before it is the same for each as
//! far as it can be: the visitor's standing is read before the token is looked up, and the
//! digest comparison runs whether or not a record was found under it. What still differs is a
//! node grant's view check, which only a found record can name.
//!
//! The record is read, checked and (for a one-time link) deleted under `LINKS_LOCK`, so two
//! opens of a one-time link cannot both succeed; and it is deleted only once the grant check has
//! passed, so a visitor the link is not for cannot burn it.

use crate::handlers::domain::async_ops::AsyncPermissionOperations;
use crate::kernel::async_kernel::AsyncWorkspaceServerKernel;
use crate::kernel::secure_links::records::LinkRecord;
use crate::kernel::secure_links::rules::{decide_resolve, granted_nodes, ResolveDecision, Visitor};
use crate::kernel::secure_links::token::digest_of;
use crate::kernel::transaction::secure_links_store::LINKS_LOCK;
use crate::{WorkspaceProtocolResponse, WORKSPACE_ROOT_ID};
use citadel_sdk::prelude::{NetworkError, Ratchet};
use citadel_workspace_types::secure_links::SecureLinksResponse;
use citadel_workspace_types::structs::Permission;
use std::collections::HashMap;

pub(super) async fn resolve<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    actor: &str,
    token: &str,
    now: u64,
) -> Result<WorkspaceProtocolResponse, NetworkError> {
    let digest = digest_of(token);
    let mut visitor = standing_of(kernel, actor).await?;
    let backend = &kernel.domain_operations.backend_tx_manager;
    let _guard = LINKS_LOCK.lock().await;
    let record = backend.link_by_digest(&digest).await?;
    if let Some(record) = &record {
        visitor.node_views = node_views(kernel, actor, record).await?;
    }
    let response = match decide_resolve(record.as_ref(), &digest, &visitor, now) {
        ResolveDecision::Unavailable => SecureLinksResponse::LinkUnavailable,
        ResolveDecision::Admit { burn } => {
            let Some(record) = record else {
                return Err(NetworkError::msg("A link was admitted with no record"));
            };
            if burn {
                backend.remove_link(&record).await?;
            } else {
                let used = LinkRecord {
                    uses: record.uses.saturating_add(1),
                    last_used_ms: Some(now),
                    ..record.clone()
                };
                backend.update_link(&record, &used).await?;
            }
            SecureLinksResponse::Resolved {
                target: record.target,
            }
        }
    };
    Ok(WorkspaceProtocolResponse::SecureLinks(response))
}

/// Who the visitor is in the workspace: whether they are a member in good standing, and their
/// role. `node_views` is filled once the record says which nodes matter.
async fn standing_of<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    actor: &str,
) -> Result<Visitor, NetworkError> {
    let ops = &kernel.domain_operations;
    let member = ops
        .holds_workspace_permission(actor, Permission::ViewContent)
        .await?;
    let role_id = match ops.backend_tx_manager.get_user(actor).await? {
        Some(user) => ops
            .role_of(WORKSPACE_ROOT_ID, &user)
            .await?
            .map(|role| role.id),
        None => None,
    };
    Ok(Visitor {
        user_id: actor.to_string(),
        member,
        role_id,
        node_views: HashMap::new(),
    })
}

async fn node_views<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    actor: &str,
    record: &LinkRecord,
) -> Result<HashMap<String, bool>, NetworkError> {
    let mut views = HashMap::new();
    for node in granted_nodes(&record.grants) {
        let can_view = kernel
            .domain_operations
            .check_entity_permission(actor, node, Permission::ViewContent)
            .await?;
        views.insert(node.to_string(), can_view);
    }
    Ok(views)
}
