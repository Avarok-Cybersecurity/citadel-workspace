//! `SecureLinks` requests: gather the facts, ask `kernel::secure_links::rules`, write the result.
//!
//! - Create needs `ShareSecureLinks`, and the creator must be able to view the target where the
//!   server can tell: a `/workspace` target naming a node needs `ViewContent` on it. Messages, the
//!   directory and peer-to-peer groups are not things the server can see, so for those the
//!   permission alone is required.
//! - List, Delete, Regenerate and Extend act on the caller's own links only. A link that is not
//!   theirs, or is expired, is `LinkUnavailable`, as an unknown one is.
//! - Resolve is in `secure_links_resolve`; the owner's actions in `secure_links_owner`.

use super::secure_links_owner::{delete, extend, list, regenerate};
use super::secure_links_resolve::resolve;
use super::telemetry::now_ms;
use crate::handlers::domain::async_ops::AsyncPermissionOperations;
use crate::kernel::async_kernel::AsyncWorkspaceServerKernel;
use crate::kernel::secure_links::quota::{LinkQuota, LinkQuotaUnavailable, LinkSource};
use crate::kernel::secure_links::records::LinkRecord;
use crate::kernel::secure_links::rules::{decide_create, CreateInput};
use crate::kernel::secure_links::target::target_node_id;
use crate::kernel::secure_links::token::{digest_of, mint_token};
use crate::kernel::transaction::secure_links_store::LINKS_LOCK;
use crate::WorkspaceProtocolResponse;
use citadel_logging::error;
use citadel_sdk::prelude::{NetworkError, Ratchet};
use citadel_workspace_types::secure_links::{
    LinkGrant, LinkLifetime, SecureLinksRequest, SecureLinksResponse,
};
use citadel_workspace_types::structs::Permission;

pub(super) type Answer = Result<WorkspaceProtocolResponse, NetworkError>;

pub(super) fn answer(response: SecureLinksResponse) -> Answer {
    Ok(WorkspaceProtocolResponse::SecureLinks(response))
}

pub(super) fn unavailable() -> Answer {
    answer(SecureLinksResponse::LinkUnavailable)
}

pub(super) async fn process<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    actor_user_id: &str,
    request: &SecureLinksRequest,
) -> Answer {
    let now = now_ms()?;
    match request {
        SecureLinksRequest::Create {
            target,
            label,
            grants,
            lifetime,
        } => create(kernel, actor_user_id, target, label, grants, lifetime, now).await,
        SecureLinksRequest::List => list(kernel, actor_user_id, now).await,
        SecureLinksRequest::Delete { id } => delete(kernel, actor_user_id, id, now).await,
        SecureLinksRequest::Regenerate { id } => regenerate(kernel, actor_user_id, id, now).await,
        SecureLinksRequest::Extend { id, ttl_ms } => {
            extend(kernel, actor_user_id, id, *ttl_ms, now).await
        }
        SecureLinksRequest::Resolve { token } => resolve(kernel, actor_user_id, token, now).await,
    }
}

/// The host's limits, or the error that says there are none to be had.
pub(super) fn quota_of<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
) -> Result<LinkQuota, String> {
    let Some(source) = kernel.link_quota_source() else {
        return Err("This server has no secure-link limit configured".to_string());
    };
    source.quota().map_err(|LinkQuotaUnavailable(detail)| {
        error!(target: "citadel", "The host could not give the secure-link limit: {detail}");
        "The workspace's secure-link limit could not be read".to_string()
    })
}

async fn create<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    actor: &str,
    target: &str,
    label: &str,
    grants: &[LinkGrant],
    lifetime: &LinkLifetime,
    now: u64,
) -> Answer {
    let ops = &kernel.domain_operations;
    let may_share = ops
        .holds_workspace_permission(actor, Permission::ShareSecureLinks)
        .await?;
    let may_view_target = match (may_share, target_node_id(target)) {
        (true, Ok(Some(node))) => {
            ops.check_entity_permission(actor, &node, Permission::ViewContent)
                .await?
        }
        // No node the server can check, or a target `decide_create` refuses anyway.
        _ => true,
    };
    let input = CreateInput {
        may_share,
        may_view_target,
        target,
        label,
        grants,
        lifetime,
        now_ms: now,
    };
    let new = match decide_create(&input) {
        Ok(new) => new,
        Err(text) => return Ok(WorkspaceProtocolResponse::Error(text)),
    };
    let quota = match quota_of(kernel) {
        Ok(quota) => quota,
        Err(text) => return Ok(WorkspaceProtocolResponse::Error(text)),
    };
    let token = mint_token()?;
    let backend = &ops.backend_tx_manager;
    let _guard = LINKS_LOCK.lock().await;
    let Some(source) = backend.link_usage(actor, now).await?.draw(quota) else {
        return answer(SecureLinksResponse::LimitReached {
            per_member: quota.per_member,
            pool: quota.pool,
        });
    };
    let record = LinkRecord {
        digest: digest_of(&token),
        id: uuid::Uuid::new_v4().to_string(),
        owner: actor.to_string(),
        target: target.to_string(),
        label: new.label,
        grants: grants.to_vec(),
        one_time: new.one_time,
        created_ms: now,
        expires_ms: new.expires_ms,
        uses: 0,
        last_used_ms: None,
        from_pool: source == LinkSource::Pool,
    };
    backend.insert_link(&record).await?;
    answer(SecureLinksResponse::Created {
        info: record.info(),
        token,
    })
}
