//! A demotion has to reach the person being demoted.
//!
//! `UpdateMemberRole` and `UpdateMemberPermissions` answered only the requester
//! — no broadcast, unlike every node write. The client's permission-cache clear
//! is gated on the payload naming the CURRENT user, which it never is for the
//! admin doing the demoting, so the whole client-side role-changed pathway
//! could only ever fire for an admin editing themselves.
//!
//! The result: a demoted admin kept every gated control until a full reload,
//! with the server refusing each use as a raw error toast, and a promoted
//! member saw nothing new.

use citadel_sdk::prelude::MonoRatchet;
use citadel_workspace_server_kernel::kernel::async_kernel::AsyncWorkspaceServerKernel;
use citadel_workspace_server_kernel::kernel::command_processor::async_process_command::process_command_with_user;
use citadel_workspace_types::structs::{User, UserRole};
use citadel_workspace_types::{WorkspaceProtocolRequest, WorkspaceProtocolResponse};
use common::workspace_test_utils::{create_test_kernel, TEST_ADMIN_USER_ID};
use std::collections::HashMap;

mod common {
    pub use ::common::*;
}

const MEMBER: &str = "member_being_demoted";

type Kernel = AsyncWorkspaceServerKernel<MonoRatchet>;

async fn add_member(kernel: &Kernel, role: UserRole) {
    kernel
        .domain_operations
        .backend_tx_manager
        .insert_user(
            MEMBER.to_string(),
            User {
                id: MEMBER.to_string(),
                name: MEMBER.to_string(),
                role,
                permissions: HashMap::new(),
                metadata: Default::default(),
            },
        )
        .await
        .expect("insert user");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_role_change_is_broadcast_to_every_client() {
    let kernel = create_test_kernel().await;
    // Promotion rather than demotion, because the last-admin guard correctly
    // refuses to demote the only administrator -- and the promoted half of this
    // finding is just as broken: a member handed Admin saw nothing new until a
    // full reload.
    add_member(&kernel, UserRole::Member).await;
    let mut rx = kernel.subscribe_broadcast();

    let response = process_command_with_user(
        &kernel,
        &WorkspaceProtocolRequest::UpdateMemberRole {
            user_id: MEMBER.to_string(),
            role: UserRole::Admin,
            metadata: None,
        },
        TEST_ADMIN_USER_ID,
    )
    .await
    .expect("dispatch");

    assert!(
        matches!(
            response,
            WorkspaceProtocolResponse::MemberRoleUpdated { .. }
        ),
        "the requester still gets its answer: {response:?}"
    );

    let broadcast = rx
        .try_recv()
        .expect("the demoted member's client must be told");
    match broadcast.response {
        WorkspaceProtocolResponse::MemberRoleUpdated { user_id, new_role } => {
            assert_eq!(user_id, MEMBER);
            assert_eq!(new_role, UserRole::Admin);
        }
        other => panic!("expected MemberRoleUpdated, got {other:?}"),
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_refused_role_change_is_not_broadcast() {
    // Announcing a demotion that did not happen would clear the member's
    // permission cache and make them re-fetch — harmless once, and a lie the
    // rest of the time.
    let kernel = create_test_kernel().await;
    add_member(&kernel, UserRole::Member).await;
    let mut rx = kernel.subscribe_broadcast();

    let response = process_command_with_user(
        &kernel,
        &WorkspaceProtocolRequest::UpdateMemberRole {
            user_id: MEMBER.to_string(),
            role: UserRole::Admin,
            metadata: None,
        },
        // Not an admin, so the operation is refused.
        MEMBER,
    )
    .await
    .expect("dispatch");

    assert!(
        matches!(response, WorkspaceProtocolResponse::Error(_)),
        "a non-admin must not be able to change roles: {response:?}"
    );
    assert!(
        rx.try_recv().is_err(),
        "a refused change must not be announced to anyone"
    );
}
