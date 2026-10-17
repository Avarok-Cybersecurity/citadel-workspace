//! The workspace's role table: reading it, and creating, editing and deleting roles.
//!
//! Every edit needs `ManageRoles`, checked before the request is looked at so a caller without
//! it is refused identically whatever they send, and then obeys the ladder (`role_edits`).
//! Reading the table is open to any member who can see the workspace: role names and colours
//! label everyone in the member list.
//!
//! A change is announced to every member, because it may move their permissions; the client
//! drops what it cached when it hears one.

use crate::kernel::async_kernel::AsyncWorkspaceServerKernel;
use crate::kernel::role_edits;
use crate::{WorkspaceProtocolResponse, WORKSPACE_ROOT_ID};
use citadel_sdk::prelude::{NetworkError, Ratchet};
use citadel_workspace_types::roles::WorkspaceRoles;
use citadel_workspace_types::roles_legacy::legacy_mirror;
use citadel_workspace_types::roles_protocol::{RolesRequest, RolesResponse};
use citadel_workspace_types::structs::Permission;

fn refused(text: String) -> Result<WorkspaceProtocolResponse, NetworkError> {
    Ok(WorkspaceProtocolResponse::Error(text))
}

pub(super) async fn process<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    actor_user_id: &str,
    requester_cid: Option<u64>,
    request: &RolesRequest,
) -> Result<WorkspaceProtocolResponse, NetworkError> {
    match request {
        RolesRequest::List => list(kernel, actor_user_id).await,
        _ => edit(kernel, actor_user_id, requester_cid, request).await,
    }
}

async fn list<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    actor_user_id: &str,
) -> Result<WorkspaceProtocolResponse, NetworkError> {
    let ops = &kernel.domain_operations;
    if !ops
        .holds_workspace_permission(actor_user_id, Permission::ViewContent)
        .await?
    {
        return refused("Permission denied: ViewContent required".to_string());
    }
    let roles = ops.backend_tx_manager.get_roles(WORKSPACE_ROOT_ID).await?;
    Ok(WorkspaceProtocolResponse::Roles(RolesResponse::Roles(
        roles,
    )))
}

async fn edit<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    actor_user_id: &str,
    requester_cid: Option<u64>,
    request: &RolesRequest,
) -> Result<WorkspaceProtocolResponse, NetworkError> {
    let ops = &kernel.domain_operations;
    let backend = &ops.backend_tx_manager;
    if !ops
        .holds_workspace_permission(actor_user_id, Permission::ManageRoles)
        .await?
    {
        return refused("Permission denied: ManageRoles required".to_string());
    }
    let actor = match ops.actor_role(actor_user_id).await {
        Ok(actor) => actor,
        Err(e) => return refused(e.into_string()),
    };

    // One lock across the table read, the holders' rewrite and both writes, so two edits do
    // not each save a table missing the other's change.
    let _workspace_guard = backend.lock_workspaces().await;
    let table = backend.get_roles(WORKSPACE_ROOT_ID).await?;
    let (role_id, next) = match request {
        RolesRequest::List => return list(kernel, actor_user_id).await,
        RolesRequest::Create {
            name,
            permissions,
            position,
            color,
        } => {
            let id = format!("role-{}", uuid::Uuid::new_v4());
            let next = role_edits::create(
                &table,
                &actor,
                id.clone(),
                name,
                permissions,
                *position,
                color.clone(),
            );
            (id, next)
        }
        RolesRequest::Update { id, changes } => {
            (id.clone(), role_edits::update(&table, &actor, id, changes))
        }
        RolesRequest::Delete { id, reassign_to } => {
            let next = role_edits::delete(&table, &actor, id, reassign_to);
            if next.is_ok() {
                reassign_holders(kernel, id, reassign_to, &table).await?;
            }
            (id.clone(), next)
        }
    };
    let next = match next {
        Ok(next) => next,
        Err(reason) => return refused(reason),
    };
    backend.save_roles(WORKSPACE_ROOT_ID, &next).await?;

    let changed = WorkspaceProtocolResponse::Roles(RolesResponse::RoleChanged {
        role_id,
        roles: next,
    });
    kernel.broadcast_to_workspace(
        changed.clone(),
        requester_cid,
        WORKSPACE_ROOT_ID.to_string(),
    );
    Ok(changed)
}

/// Move every account holding `from` to `to`. Every account, not only current members: one
/// added to a room before ever connecting holds its role too, and would otherwise be left
/// naming a role that no longer exists. The caller holds `lock_workspaces`.
async fn reassign_holders<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    from: &str,
    to: &str,
    table: &WorkspaceRoles,
) -> Result<(), NetworkError> {
    let backend = &kernel.domain_operations.backend_tx_manager;
    let Some(target) = table.get(to) else {
        return Ok(());
    };
    for (user_id, mut user) in backend.get_all_users().await? {
        if user.role_id_in(WORKSPACE_ROOT_ID) != Some(from) {
            continue;
        }
        user.workspace_roles
            .insert(WORKSPACE_ROOT_ID.to_string(), target.id.clone());
        user.role = legacy_mirror(&target.id, &target.name);
        backend.insert_user(user_id, user).await?;
    }
    Ok(())
}
