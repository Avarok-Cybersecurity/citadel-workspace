//! The messaging trust policy: who may set it, and the check a client asks before it accepts
//! or sends a registration without asking its user.
//!
//! The check is the server's because a client's roster and settings are only its cache: a
//! client deciding from them would auto-accept whoever its cache said was a colleague. The
//! peer is named by the username the SDK relayed with the request, which the SDK authenticates.
//!
//! The workspace policy needs `EditWorkspaceConfig`, checked before the input is looked at so a
//! caller without it is refused identically whatever they send. A member's own needs
//! `ViewContent`. Reading the settings and asking the check are open to every signed-in user:
//! a caller outside the trusted root is answered `trusted: false` for any peer, which says
//! nothing about the peer.

use super::workspace_record::mutate_workspace;
use crate::handlers::domain::async_ops::AsyncPermissionOperations;
use crate::handlers::domain::server_ops::metadata_merge::merge_metadata_document;
use crate::kernel::async_kernel::AsyncWorkspaceServerKernel;
use crate::kernel::trust_scope::{
    personal_policy, set_personal_policy, trusts, within, workspace_policy,
};
use crate::{WorkspaceProtocolResponse, WORKSPACE_ROOT_ID};
use citadel_sdk::prelude::{NetworkError, Ratchet};
use citadel_workspace_types::messaging_trust::{
    effective_trusted_root, personal_is_within_workspace, MessagingTrustPolicy,
    MessagingTrustRequest, MessagingTrustResponse, MessagingTrustSettings,
    MESSAGING_TRUST_POLICY_KEY,
};
use citadel_workspace_types::structs::{Permission, Workspace};

fn answer(response: MessagingTrustResponse) -> Result<WorkspaceProtocolResponse, NetworkError> {
    Ok(WorkspaceProtocolResponse::MessagingTrust(response))
}

async fn root_workspace<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
) -> Result<Workspace, NetworkError> {
    kernel
        .domain_operations
        .backend_tx_manager
        .get_workspace(WORKSPACE_ROOT_ID)
        .await?
        .ok_or_else(|| NetworkError::msg("The root workspace does not exist"))
}

async fn has_permission<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    actor_user_id: &str,
    permission: Permission,
) -> bool {
    kernel
        .domain_operations
        .check_entity_permission(actor_user_id, WORKSPACE_ROOT_ID, permission)
        .await
        .unwrap_or(false)
}

fn refused(permission: Permission) -> Result<WorkspaceProtocolResponse, NetworkError> {
    Ok(WorkspaceProtocolResponse::Error(format!(
        "Permission denied: {permission:?} required"
    )))
}

pub(super) async fn process<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    actor_user_id: &str,
    requester_cid: Option<u64>,
    request: &MessagingTrustRequest,
) -> Result<WorkspaceProtocolResponse, NetworkError> {
    match request {
        MessagingTrustRequest::GetMessagingTrustSettings => settings(kernel, actor_user_id).await,
        MessagingTrustRequest::SetWorkspaceMessagingTrust { policy } => {
            if !has_permission(kernel, actor_user_id, Permission::EditWorkspaceConfig).await {
                return refused(Permission::EditWorkspaceConfig);
            }
            set_workspace_policy(kernel, actor_user_id, requester_cid, policy).await
        }
        MessagingTrustRequest::SetMyMessagingTrust { policy } => {
            if !has_permission(kernel, actor_user_id, Permission::ViewContent).await {
                return refused(Permission::ViewContent);
            }
            set_my_policy(kernel, actor_user_id, policy.as_ref()).await
        }
        MessagingTrustRequest::CheckMessagingTrust { peer_username } => {
            check(kernel, actor_user_id, peer_username).await
        }
    }
}

async fn settings<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    actor_user_id: &str,
) -> Result<WorkspaceProtocolResponse, NetworkError> {
    let backend = &kernel.domain_operations.backend_tx_manager;
    let nodes = backend.get_all_nodes_shared().await?;
    let workspace = workspace_policy(&root_workspace(kernel).await?.metadata);
    let mine = backend
        .get_user(actor_user_id)
        .await?
        .as_ref()
        .and_then(personal_policy);
    let effective_root = effective_trusted_root(&workspace, mine.as_ref(), |node, ancestor| {
        within(&nodes, node, ancestor)
    })
    .map(str::to_string);
    answer(MessagingTrustResponse::Settings(MessagingTrustSettings {
        workspace,
        mine,
        effective_root,
    }))
}

async fn set_workspace_policy<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    actor_user_id: &str,
    requester_cid: Option<u64>,
    policy: &MessagingTrustPolicy,
) -> Result<WorkspaceProtocolResponse, NetworkError> {
    if let MessagingTrustPolicy::NodeLevelTrusted { node_id } = policy {
        let nodes = kernel
            .domain_operations
            .backend_tx_manager
            .get_all_nodes_shared()
            .await?;
        if node_id != WORKSPACE_ROOT_ID && !nodes.contains_key(node_id) {
            return Ok(WorkspaceProtocolResponse::Error(format!(
                "No node {node_id} exists to trust"
            )));
        }
    }
    let patch = serde_json::to_vec(&serde_json::json!({ MESSAGING_TRUST_POLICY_KEY: policy }))
        .map_err(|e| NetworkError::msg(format!("Failed to encode the policy: {e}")))?;
    let written = mutate_workspace(
        kernel,
        WORKSPACE_ROOT_ID,
        requester_cid,
        "messaging trust",
        |workspace| {
            // Merged under its own key: metadata is shared with `initialized`, `theme`, `logo`.
            workspace.metadata = merge_metadata_document(&workspace.metadata, &patch)?;
            Ok(())
        },
    )
    .await?;
    match written {
        WorkspaceProtocolResponse::Workspace(_) => settings(kernel, actor_user_id).await,
        refusal => Ok(refusal),
    }
}

async fn set_my_policy<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    actor_user_id: &str,
    policy: Option<&MessagingTrustPolicy>,
) -> Result<WorkspaceProtocolResponse, NetworkError> {
    let backend = &kernel.domain_operations.backend_tx_manager;
    {
        // The same lock every user-record writer takes, held across the read and the write.
        let _workspace_guard = backend.lock_workspaces().await;
        let nodes = backend.get_all_nodes_shared().await?;
        let workspace = workspace_policy(&root_workspace(kernel).await?.metadata);
        if !personal_is_within_workspace(&workspace, policy, |node, ancestor| {
            within(&nodes, node, ancestor)
        }) {
            return Ok(WorkspaceProtocolResponse::Error(
                "Your own setting can only narrow the workspace's: choose a node inside it, or \
                 ask every time"
                    .to_string(),
            ));
        }
        let Some(mut user) = backend.get_user(actor_user_id).await? else {
            return Ok(WorkspaceProtocolResponse::Error(
                "User not found".to_string(),
            ));
        };
        if let Err(e) = set_personal_policy(&mut user, policy) {
            return Ok(WorkspaceProtocolResponse::Error(e));
        }
        backend.insert_user(actor_user_id.to_string(), user).await?;
    }
    settings(kernel, actor_user_id).await
}

async fn check<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    actor_user_id: &str,
    peer_username: &str,
) -> Result<WorkspaceProtocolResponse, NetworkError> {
    let backend = &kernel.domain_operations.backend_tx_manager;
    let untrusted = MessagingTrustResponse::PeerTrust {
        peer_username: peer_username.to_string(),
        trusted: false,
        peer_trusts_caller: false,
    };
    let (Some(caller), Some(peer)) = (
        backend.get_user(actor_user_id).await?,
        backend.get_user(peer_username).await?,
    ) else {
        return answer(untrusted);
    };
    let nodes = backend.get_all_nodes_shared().await?;
    let workspace = root_workspace(kernel).await?;
    let policy = workspace_policy(&workspace.metadata);
    let decide = |owner, other| {
        trusts(
            &nodes,
            &policy,
            &workspace.id,
            &workspace.members,
            owner,
            other,
        )
    };
    answer(MessagingTrustResponse::PeerTrust {
        peer_username: peer_username.to_string(),
        trusted: decide(&caller, &peer),
        peer_trusts_caller: decide(&peer, &caller),
    })
}
