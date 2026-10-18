//! The owner's actions on their links: List, Delete, Regenerate and Extend. A link that is not
//! the caller's, or has expired, is `LinkUnavailable`, as an unknown one is.

use super::secure_links::{answer, quota_of, unavailable, Answer};
use crate::kernel::async_kernel::AsyncWorkspaceServerKernel;
use crate::kernel::secure_links::records::LinkRecord;
use crate::kernel::secure_links::rules::expiry_at;
use crate::kernel::secure_links::token::{digest_of, mint_token};
use crate::kernel::transaction::secure_links_store::LINKS_LOCK;
use crate::WorkspaceProtocolResponse;
use citadel_sdk::prelude::{NetworkError, Ratchet};
use citadel_workspace_types::secure_links::SecureLinksResponse;

/// `owner`'s live links, oldest first. The caller holds `LINKS_LOCK`.
async fn live_links_of<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    owner: &str,
    now: u64,
) -> Result<Vec<LinkRecord>, NetworkError> {
    let backend = &kernel.domain_operations.backend_tx_manager;
    let mut links = Vec::new();
    for entry in backend.link_index(owner).await? {
        if entry.expires_ms <= now {
            continue;
        }
        if let Some(record) = backend.link_by_digest(&entry.digest).await? {
            if record.owner == owner && record.live_at(now) {
                links.push(record);
            }
        }
    }
    links.sort_by(|a, b| (a.created_ms, &a.id).cmp(&(b.created_ms, &b.id)));
    Ok(links)
}

async fn own_live_link<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    owner: &str,
    id: &str,
    now: u64,
) -> Result<Option<LinkRecord>, NetworkError> {
    Ok(live_links_of(kernel, owner, now)
        .await?
        .into_iter()
        .find(|record| record.id == id))
}

pub(super) async fn list<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    actor: &str,
    now: u64,
) -> Answer {
    let quota = match quota_of(kernel) {
        Ok(quota) => quota,
        Err(text) => return Ok(WorkspaceProtocolResponse::Error(text)),
    };
    let _guard = LINKS_LOCK.lock().await;
    let usage = kernel
        .domain_operations
        .backend_tx_manager
        .link_usage(actor, now)
        .await?;
    let links = live_links_of(kernel, actor, now).await?;
    answer(SecureLinksResponse::Links {
        live: u32::try_from(links.len()).map_err(|_| NetworkError::msg("Too many links"))?,
        links: links.iter().map(LinkRecord::info).collect(),
        per_member: quota.per_member,
        pool: quota.pool,
        pool_used: usage.pool_used,
    })
}

pub(super) async fn delete<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    actor: &str,
    id: &str,
    now: u64,
) -> Answer {
    let _guard = LINKS_LOCK.lock().await;
    let Some(record) = own_live_link(kernel, actor, id, now).await? else {
        return unavailable();
    };
    let backend = &kernel.domain_operations.backend_tx_manager;
    backend.remove_link(&record).await?;
    answer(SecureLinksResponse::Deleted { id: record.id })
}

pub(super) async fn regenerate<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    actor: &str,
    id: &str,
    now: u64,
) -> Answer {
    let token = mint_token()?;
    let _guard = LINKS_LOCK.lock().await;
    let Some(old) = own_live_link(kernel, actor, id, now).await? else {
        return unavailable();
    };
    let backend = &kernel.domain_operations.backend_tx_manager;
    let new = LinkRecord {
        digest: digest_of(&token),
        ..old.clone()
    };
    // The old token dies first: a failure between the two writes loses the link, never
    // leaves both tokens working.
    backend.remove_link(&old).await?;
    backend.insert_link(&new).await?;
    answer(SecureLinksResponse::Regenerated {
        info: new.info(),
        token,
    })
}

pub(super) async fn extend<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    actor: &str,
    id: &str,
    ttl_ms: u64,
    now: u64,
) -> Answer {
    let expires_ms = match expiry_at(now, ttl_ms) {
        Ok(expires_ms) => expires_ms,
        Err(text) => return Ok(WorkspaceProtocolResponse::Error(text)),
    };
    let _guard = LINKS_LOCK.lock().await;
    let Some(before) = own_live_link(kernel, actor, id, now).await? else {
        return unavailable();
    };
    let after = LinkRecord {
        expires_ms,
        ..before.clone()
    };
    let backend = &kernel.domain_operations.backend_tx_manager;
    backend.update_link(&before, &after).await?;
    answer(SecureLinksResponse::Extended { info: after.info() })
}
