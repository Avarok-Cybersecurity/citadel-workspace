//! What the in-crate apps tests share: a workspace with members in several roles, a small
//! tree, and a way to ask the kernel. Publishers, manifests and artifacts are `test_manifests`.
//!
//! No doubles: the kernel is the real one over its in-memory backend, the signatures are real
//! ML-DSA-65, and the only host capability, the artifact fetcher, is absent unless a test passes
//! one.

use crate::kernel::async_kernel::AsyncWorkspaceServerKernel;
use crate::kernel::command_processor::async_process_command::process_command_with_user;
use crate::WORKSPACE_ROOT_ID;
use citadel_sdk::prelude::MonoRatchet;
use citadel_workspace_types::apps_protocol::AppsRequest;
use citadel_workspace_types::apps_responses::AppsResponse;
use citadel_workspace_types::roles::{RoleDefinition, WorkspaceRoles};
use citadel_workspace_types::structs::{
    DomainNode, DomainPermissions, NodeEntityType, Permission, User, UserRole,
};
use citadel_workspace_types::{WorkspaceProtocolRequest, WorkspaceProtocolResponse};
use std::collections::HashMap;

pub(crate) type Kernel = AsyncWorkspaceServerKernel<MonoRatchet>;

/// The custom roles, beside the seeds.
fn custom_roles() -> Vec<RoleDefinition> {
    use Permission::*;
    let role = |id: &str, position: u16, permissions: &[Permission]| RoleDefinition {
        id: id.to_string(),
        name: id.to_string(),
        permissions: permissions.iter().copied().collect(),
        position,
        color: None,
    };
    vec![
        role(
            "appadmin",
            260,
            &[
                ViewContent,
                EditMdx,
                AppManage,
                AppPublish,
                AppInstall,
                AppInstallScoped,
                UpdateNodeSettings,
                AppInstallAllowNodeRead,
                AppInstallAllowStorage,
            ],
        ),
        role(
            "installer",
            250,
            &[
                ViewContent,
                AppInstall,
                AppInstallScoped,
                UpdateNodeSettings,
                AppInstallAllowNodeRead,
            ],
        ),
        role("editor", 240, &[ViewContent, EditMdx, AppInstall]),
        role("blind", 150, &[AppInstall]),
    ]
}

/// boss: Admin. mgr: appadmin. inst: installer. ed: editor. alice, bob: Member. carol: blind,
/// with `ViewContent` on `room` only. The tree is `office > room`.
pub(crate) async fn workspace() -> Kernel {
    let mut kernel = Kernel::new(None);
    // The tests' node runs in memory, which sets app storage no workspace-wide limit.
    let in_memory = citadel_sdk::prelude::BackendType::InMemory;
    let entitlement = crate::kernel::apps::storage_entitlement::StorageEntitlement::of(&in_memory);
    kernel.set_storage_entitlement(Some(entitlement));
    let backend = &kernel.domain_operations.backend_tx_manager;
    backend.init().await.expect("init");
    kernel
        .inject_admin_user("a-master-password")
        .await
        .expect("workspace");
    let mut roles = WorkspaceRoles::seeded();
    roles.roles.extend(custom_roles());
    backend
        .save_roles(WORKSPACE_ROOT_ID, &roles.normalized())
        .await
        .expect("roles");
    let people = [
        ("boss", "admin"),
        ("mgr", "appadmin"),
        ("inst", "installer"),
        ("ed", "editor"),
        ("alice", "member"),
        ("bob", "member"),
        ("carol", "blind"),
    ];
    let mut workspace = backend
        .get_workspace(WORKSPACE_ROOT_ID)
        .await
        .expect("read")
        .expect("root");
    for (id, role) in people {
        let mut user = User {
            workspace_roles: std::iter::once((WORKSPACE_ROOT_ID.to_string(), role.to_string()))
                .collect(),
            ..User::new(id.to_string(), id.to_string(), UserRole::Member)
        };
        if id == "carol" {
            user.permissions
                .insert("room".to_string(), [Permission::ViewContent].into());
        }
        backend
            .insert_user(id.to_string(), user)
            .await
            .expect("user");
        workspace.members.push(id.to_string());
    }
    backend
        .insert_workspace(WORKSPACE_ROOT_ID.to_string(), workspace)
        .await
        .expect("save");
    for (id, parent, depth) in [("office", WORKSPACE_ROOT_ID, 1), ("room", "office", 2)] {
        backend
            .insert_node(id.to_string(), node(id, parent, depth))
            .await
            .expect("node");
    }
    kernel
}

fn node(id: &str, parent: &str, depth: u32) -> DomainNode {
    DomainNode {
        id: id.to_string(),
        parent_id: Some(parent.to_string()),
        entity_type: NodeEntityType::Child("Office".to_string()),
        depth,
        name: id.to_string(),
        description: String::new(),
        owner_id: "boss".to_string(),
        members: vec![],
        children: vec![],
        mdx_content: "# Body\n".to_string(),
        mdx_content_hash: Some(citadel_workspace_types::structs::mdx_content_hash(
            "# Body\n",
        )),
        rules: None,
        chat_enabled: false,
        chat_channel_id: None,
        default_permissions: DomainPermissions::default(),
        metadata: vec![],
        allowed_child_types: None,
        is_default: false,
        created_at: 0,
        updated_at: 0,
    }
}

pub(crate) async fn ask(kernel: &Kernel, user: &str, request: AppsRequest) -> AppsResponse {
    let request = WorkspaceProtocolRequest::Apps(request);
    match process_command_with_user(kernel, &request, user).await {
        Ok(WorkspaceProtocolResponse::Apps(response)) => response,
        other => panic!("{other:?}"),
    }
}

/// What `stored_entries` holds under the apps prefix, by key.
pub(crate) fn apps_keys(kernel: &Kernel) -> HashMap<String, Vec<u8>> {
    let entries = kernel.domain_operations.backend_tx_manager.stored_entries();
    entries
        .into_iter()
        .filter(|(key, _)| key.starts_with("citadel_workspace.apps."))
        .collect()
}
