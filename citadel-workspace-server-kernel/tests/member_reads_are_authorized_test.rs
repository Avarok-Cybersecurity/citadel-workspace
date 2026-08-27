//! Reading who someone is, and who is in a room, requires standing to ask.
//!
//! `GetMember` had no check at all. A `User` carries the role, the FULL
//! per-domain permissions map and the metadata — so any authenticated account
//! could enumerate every other account and read the entire enforced permission
//! state of the workspace. That is the reconnaissance step for every
//! privilege-grant path in this kernel.
//!
//! `ListMembers` took `domain_id` from the request and trusted it, returning the
//! complete roster — names, roles, permission maps — of any office or room,
//! including ones the caller was never added to.
//!
//! `GetUserPermissions`, fifteen lines below `GetMember`, has always gated this
//! same data correctly. The rule existed; two handlers just did not apply it.

use citadel_workspace_server_kernel::kernel::command_processor::async_process_command::process_command_with_user;
use citadel_workspace_server_kernel::WORKSPACE_ROOT_ID;
use citadel_workspace_types::structs::{User, UserRole};
use citadel_workspace_types::{WorkspaceProtocolRequest, WorkspaceProtocolResponse};
use common::workspace_test_utils::{create_test_kernel, TEST_ADMIN_USER_ID};
use std::collections::HashMap;

const OUTSIDER: &str = "outsider";
const INSIDER: &str = "insider";

async fn add_user(
    kernel: &citadel_workspace_server_kernel::kernel::async_kernel::AsyncWorkspaceServerKernel<
        citadel_sdk::prelude::MonoRatchet,
    >,
    id: &str,
) {
    kernel
        .domain_operations
        .backend_tx_manager
        .insert_user(
            id.to_string(),
            User {
                id: id.to_string(),
                name: id.to_string(),
                role: UserRole::Member,
                permissions: HashMap::new(),
                metadata: Default::default(),
            },
        )
        .await
        .expect("insert user");
}

fn is_denied(response: &WorkspaceProtocolResponse) -> bool {
    matches!(response, WorkspaceProtocolResponse::Error(e) if e.contains("Permission denied"))
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_member_cannot_read_another_members_record() {
    let kernel = create_test_kernel().await;
    add_user(&kernel, OUTSIDER).await;
    add_user(&kernel, INSIDER).await;

    let response = process_command_with_user(
        &kernel,
        &WorkspaceProtocolRequest::GetMember {
            user_id: INSIDER.to_string(),
        },
        OUTSIDER,
    )
    .await
    .expect("dispatch");

    assert!(
        is_denied(&response),
        "a User carries the role and the whole permissions map; got {response:?}"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_member_can_still_read_their_own_record() {
    let kernel = create_test_kernel().await;
    add_user(&kernel, OUTSIDER).await;

    let response = process_command_with_user(
        &kernel,
        &WorkspaceProtocolRequest::GetMember {
            user_id: OUTSIDER.to_string(),
        },
        OUTSIDER,
    )
    .await
    .expect("dispatch");

    assert!(
        matches!(&response, WorkspaceProtocolResponse::Member(u) if u.id == OUTSIDER),
        "reading your own record must keep working; got {response:?}"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_admin_can_read_any_member() {
    let kernel = create_test_kernel().await;
    add_user(&kernel, INSIDER).await;

    let response = process_command_with_user(
        &kernel,
        &WorkspaceProtocolRequest::GetMember {
            user_id: INSIDER.to_string(),
        },
        TEST_ADMIN_USER_ID,
    )
    .await
    .expect("dispatch");

    assert!(
        matches!(&response, WorkspaceProtocolResponse::Member(u) if u.id == INSIDER),
        "administration still requires reading member records; got {response:?}"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_non_member_cannot_list_a_domain_roster() {
    let kernel = create_test_kernel().await;
    add_user(&kernel, OUTSIDER).await;

    let response = process_command_with_user(
        &kernel,
        &WorkspaceProtocolRequest::ListMembers {
            domain_id: Some(WORKSPACE_ROOT_ID.to_string()),
        },
        OUTSIDER,
    )
    .await
    .expect("dispatch");

    assert!(
        is_denied(&response),
        "domain_id came from the request and was trusted; got {response:?}"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_admin_can_list_the_roster() {
    let kernel = create_test_kernel().await;

    let response = process_command_with_user(
        &kernel,
        &WorkspaceProtocolRequest::ListMembers {
            domain_id: Some(WORKSPACE_ROOT_ID.to_string()),
        },
        TEST_ADMIN_USER_ID,
    )
    .await
    .expect("dispatch");

    assert!(
        matches!(response, WorkspaceProtocolResponse::Members(_)),
        "the admin panel must still be able to list members; got {response:?}"
    );
}
