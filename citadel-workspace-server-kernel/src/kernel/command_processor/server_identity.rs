//! The requests the server's identity answers: `ServerIdentityChallenge`, `GetWorkspace`'s
//! `accepted_domains`, and the context an `UpdateUserProfile.identity_binding` is checked in.

use crate::kernel::async_kernel::AsyncWorkspaceServerKernel;
use crate::kernel::identity_binding::BindingWrite;
use crate::platform::{Instant, SystemTime, UNIX_EPOCH};
use citadel_sdk::prelude::Ratchet;
use citadel_workspace_types::server_identity::ServerIdentityChallenge;
use citadel_workspace_types::structs::Workspace;
use citadel_workspace_types::WorkspaceProtocolResponse;

pub const NO_IDENTITY: &str = "this workspace server has no [identity] configured";

/// `ServerIdentityChallenge` from the session `requester_cid`.
pub fn challenge<R: Ratchet>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    challenge: &ServerIdentityChallenge,
    requester_cid: Option<u64>,
) -> WorkspaceProtocolResponse {
    match kernel.server_identity() {
        Some(identity) => identity.answer(requester_cid, challenge, Instant::now()),
        None => WorkspaceProtocolResponse::Error(NO_IDENTITY.to_string()),
    }
}

/// `workspace` as `GetWorkspace` answers it: with this server's domains, canonical first. A
/// kernel with no identity answers to no domain.
pub fn with_accepted_domains<R: Ratchet>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    mut workspace: Workspace,
) -> Workspace {
    workspace.accepted_domains = match kernel.server_identity() {
        Some(identity) => identity.accepted_domain_names(),
        None => Vec::new(),
    };
    workspace
}

/// What `blob` is checked against when an `UpdateUserProfile` carries one.
pub fn binding_write<R: Ratchet>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    blob: Option<&String>,
) -> Result<Option<BindingWrite>, String> {
    let Some(blob) = blob else {
        return Ok(None);
    };
    let identity = kernel.server_identity().as_ref().ok_or(NO_IDENTITY)?;
    let now_s = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| format!("the server clock is before 1970: {e}"))?
        .as_secs();
    Ok(Some(BindingWrite {
        blob_base64url: blob.clone(),
        accepted: identity.accepted_domains(),
        now_s,
    }))
}
