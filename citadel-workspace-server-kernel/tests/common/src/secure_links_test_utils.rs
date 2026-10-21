//! Driving `SecureLinksRequest` through the dispatch every client request takes.
//!
//! The kernel is real and so is its store (in memory, as for every kernel test). The one host
//! capability, the link limit, is the native server's own `FixedLinkQuota`, so no double.

use crate::member_test_utils::{insert_user_with_role, join_root, GateKernel};
use crate::workspace_test_utils::create_configured_test_kernel;
use citadel_workspace_server_kernel::kernel::command_processor::async_process_command::process_command_with_user;
use citadel_workspace_server_kernel::kernel::secure_links::quota::{FixedLinkQuota, LinkQuota};
use citadel_workspace_types::secure_links::{
    LinkGrant, LinkLifetime, SecureLinkInfo, SecureLinksRequest, SecureLinksResponse,
};
use citadel_workspace_types::structs::UserRole;
use citadel_workspace_types::{WorkspaceProtocolRequest, WorkspaceProtocolResponse};
use std::sync::Arc;

pub const HOUR_MS: u64 = 60 * 60 * 1000;

/// A kernel whose members may each hold `per_member` links, sharing `pool` more.
pub async fn links_kernel(per_member: u32, pool: u32) -> Arc<GateKernel> {
    links_kernel_with(LinkQuota::counts(per_member, pool)).await
}

/// A kernel with the link limits `quota`, either of which may be none.
pub async fn links_kernel_with(quota: LinkQuota) -> Arc<GateKernel> {
    create_configured_test_kernel(|kernel| {
        kernel.set_link_quota_source(Some(Arc::new(FixedLinkQuota(quota))))
    })
    .await
}

/// `id`, a member of the workspace in `role`.
pub async fn enrol(kernel: &GateKernel, id: &str, role: UserRole) {
    insert_user_with_role(kernel, id, role).await;
    join_root(kernel, id).await;
}

/// What the kernel answers `user`, which must be a `SecureLinks` response.
pub async fn links(
    kernel: &GateKernel,
    user: &str,
    request: SecureLinksRequest,
) -> Result<SecureLinksResponse, String> {
    let response = process_command_with_user(
        kernel,
        &WorkspaceProtocolRequest::SecureLinks(request),
        user,
    )
    .await
    .expect("answered, never a transport error");
    match response {
        WorkspaceProtocolResponse::SecureLinks(answer) => Ok(answer),
        WorkspaceProtocolResponse::Error(text) => Err(text),
        other => panic!("not a SecureLinks answer: {other:?}"),
    }
}

pub fn expires(ttl_ms: u64) -> LinkLifetime {
    LinkLifetime::Expires { ttl_ms }
}

pub fn one_time(ttl_ms: u64) -> LinkLifetime {
    LinkLifetime::OneTime { ttl_ms }
}

pub fn members(names: &[&str]) -> Vec<LinkGrant> {
    vec![LinkGrant::Members(
        names.iter().map(|n| n.to_string()).collect(),
    )]
}

/// The raw answer to a Create.
pub async fn try_create(
    kernel: &GateKernel,
    owner: &str,
    target: &str,
    grants: Vec<LinkGrant>,
    lifetime: LinkLifetime,
) -> Result<SecureLinksResponse, String> {
    links(
        kernel,
        owner,
        SecureLinksRequest::Create {
            target: target.to_string(),
            label: "a link".to_string(),
            grants,
            lifetime,
        },
    )
    .await
}

/// Create a link that must be made; its info and its token.
pub async fn create(
    kernel: &GateKernel,
    owner: &str,
    target: &str,
    grants: Vec<LinkGrant>,
    lifetime: LinkLifetime,
) -> (SecureLinkInfo, String) {
    match try_create(kernel, owner, target, grants, lifetime).await {
        Ok(SecureLinksResponse::Created { info, token }) => (info, token),
        other => panic!("{owner} could not make a link: {other:?}"),
    }
}

/// What `visitor` is told when they open `token`.
pub async fn resolve(kernel: &GateKernel, visitor: &str, token: &str) -> SecureLinksResponse {
    links(
        kernel,
        visitor,
        SecureLinksRequest::Resolve {
            token: token.to_string(),
        },
    )
    .await
    .expect("Resolve is never an Error")
}

pub fn opened(response: &SecureLinksResponse, target: &str) -> bool {
    matches!(response, SecureLinksResponse::Resolved { target: t } if t == target)
}

pub fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("clock after the epoch")
        .as_millis() as u64
}
