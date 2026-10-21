//! What the in-crate secure-link tests share: a kernel with one member, and records to store.

use super::quota::{FixedLinkQuota, LinkQuota};
use super::records::LinkRecord;
use super::token::digest_of;
use crate::kernel::async_kernel::AsyncWorkspaceServerKernel;
use crate::WORKSPACE_ROOT_ID;
use citadel_sdk::prelude::MonoRatchet;
use citadel_workspace_types::secure_links::LinkGrant;
use citadel_workspace_types::structs::{User, UserRole};
use std::sync::Arc;

pub(crate) type Kernel = AsyncWorkspaceServerKernel<MonoRatchet>;

pub(crate) async fn kernel_with_member(id: &str) -> Kernel {
    let mut kernel = Kernel::new(None);
    kernel.set_link_quota_source(Some(Arc::new(FixedLinkQuota(LinkQuota::counts(50, 0)))));
    let backend = &kernel.domain_operations.backend_tx_manager;
    backend.init().await.expect("init");
    kernel
        .inject_admin_user("a-master-password")
        .await
        .expect("workspace");
    let user = User::new(id.to_string(), id.to_string(), UserRole::Member);
    backend
        .insert_user(id.to_string(), user)
        .await
        .expect("user");
    let mut workspace = backend
        .get_workspace(WORKSPACE_ROOT_ID)
        .await
        .expect("read")
        .expect("root");
    workspace.members.push(id.to_string());
    backend
        .insert_workspace(WORKSPACE_ROOT_ID.to_string(), workspace)
        .await
        .expect("save");
    kernel
}

/// A link of `owner`'s, numbered `n`, expiring at `expires_ms`.
pub(crate) fn record(owner: &str, n: u64, expires_ms: u64) -> LinkRecord {
    LinkRecord {
        digest: digest_of(&format!("{owner}-{n}")),
        id: format!("{owner}-{n}"),
        owner: owner.to_string(),
        target: "/messages".to_string(),
        label: String::new(),
        grants: vec![LinkGrant::Workspace],
        one_time: false,
        created_ms: 0,
        expires_ms,
        uses: 0,
        last_used_ms: None,
        from_pool: false,
    }
}
