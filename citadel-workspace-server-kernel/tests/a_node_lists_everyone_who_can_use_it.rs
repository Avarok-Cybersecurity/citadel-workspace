//! A node's member list names everyone who can use the node.
//!
//! Found live (2026-09-29): an office's list showed only people added to that
//! office, while workspace members read and posted in its chat through the level
//! above -- `is_member_of_domain` walks up, `ListMembers` did not. The owner's
//! rule: anyone with access sees everyone else with access, and people who come
//! through a level above are marked with it.
//!
//! Real: the kernel, its command processor and the in-memory backend. Every
//! request is made as a Member, not as the test admin, because the admin passes
//! gates a member would not.
use citadel_workspace_server_kernel::handlers::domain::async_ops::AsyncUserManagementOperations;
use citadel_workspace_server_kernel::handlers::domain::node_ops::AsyncNodeOperations;
use citadel_workspace_server_kernel::kernel::command_processor::async_process_command::process_command_with_user;
use citadel_workspace_types::structs::{NodeEntityType, UserRole};
use citadel_workspace_types::{WorkspaceProtocolRequest, WorkspaceProtocolResponse};
use common::member_test_utils::{insert_user_with_role, join_root, GateKernel as Kernel};
use common::workspace_test_utils::{create_test_kernel, TEST_ADMIN_USER_ID};
use std::collections::HashMap;

const ROOT: &str = citadel_workspace_server_kernel::WORKSPACE_ROOT_ID;

async fn node(kernel: &Kernel, parent: &str, kind: &str, name: &str) -> String {
    kernel
        .domain_operations
        .create_node(TEST_ADMIN_USER_ID, Some(parent), &NodeEntityType::Child(kind.to_string()), name, "")
        .await
        .expect("an admin may create the node")
        .id
}

async fn member(kernel: &Kernel, id: &str, role: UserRole) {
    insert_user_with_role(kernel, id, role).await;
    join_root(kernel, id).await;
}

/// The roster as `viewer` sees it: member ids, and who came from where.
async fn roster(kernel: &Kernel, viewer: &str, domain: &str) -> Result<(Vec<String>, HashMap<String, String>), String> {
    let request = WorkspaceProtocolRequest::ListMembers { domain_id: Some(domain.to_string()) };
    match process_command_with_user(kernel, &request, viewer).await.expect("dispatch") {
        WorkspaceProtocolResponse::Members { members, inherited_from, .. } => {
            Ok((members.into_iter().map(|m| m.id).collect(), inherited_from))
        }
        WorkspaceProtocolResponse::Error(message) => Err(message),
        other => panic!("expected Members or Error, got {other:?}"),
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_office_lists_the_workspace_members_who_can_use_it() {
    let kernel = create_test_kernel().await;
    member(&kernel, "ann", UserRole::Member).await;
    member(&kernel, "bea", UserRole::Member).await;
    let office = node(&kernel, ROOT, "Office", "Ops").await;

    let (ids, via) = roster(&kernel, "ann", &office).await.expect("a member may list an office she can use");
    for id in ["ann", "bea"] {
        assert!(ids.contains(&id.to_string()), "{id} reaches the office through the workspace and is missing: {ids:?}");
        assert_eq!(via.get(id).map(String::as_str), Some(ROOT), "{id} must be marked as coming from the workspace");
    }
    // The creator is on the office itself: listed, and not marked.
    assert!(ids.contains(&TEST_ADMIN_USER_ID.to_string()));
    assert_eq!(via.get(TEST_ADMIN_USER_ID), None, "a direct member is not marked as inherited");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_room_marks_each_person_with_the_nearest_level() {
    let kernel = create_test_kernel().await;
    member(&kernel, "ann", UserRole::Member).await;
    member(&kernel, "bea", UserRole::Member).await;
    let office = node(&kernel, ROOT, "Office", "Ops").await;
    let room = node(&kernel, &office, "Room", "Standup").await;
    kernel
        .domain_operations
        .add_user_to_domain(TEST_ADMIN_USER_ID, "bea", &office, UserRole::Member)
        .await
        .expect("an admin may add bea to the office");

    let (_, via) = roster(&kernel, "ann", &room).await.expect("ann may list the room");
    assert_eq!(via.get("bea").map(String::as_str), Some(office.as_str()), "bea is on the office above the room");
    assert_eq!(via.get("ann").map(String::as_str), Some(ROOT), "ann only through the workspace");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_banned_account_is_not_on_any_roster() {
    let kernel = create_test_kernel().await;
    member(&kernel, "ann", UserRole::Member).await;
    // A ban sets the role and leaves the account in the workspace's list.
    member(&kernel, "exiled", UserRole::Banned).await;
    let office = node(&kernel, ROOT, "Office", "Ops").await;

    let (ids, _) = roster(&kernel, "ann", &office).await.expect("ann may list the office");
    assert!(!ids.contains(&"exiled".to_string()), "a banned account has no access and must not be listed: {ids:?}");
    // The control: the same account IS in the stored list, so the filter is what removed it.
    let workspace = kernel.domain_operations.backend_tx_manager.get_workspace(ROOT).await.unwrap().unwrap();
    assert!(workspace.members.contains(&"exiled".to_string()));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn someone_outside_the_workspace_is_still_refused() {
    let kernel = create_test_kernel().await;
    insert_user_with_role(&kernel, "stranger", UserRole::Member).await;
    let office = node(&kernel, ROOT, "Office", "Ops").await;

    let refused = roster(&kernel, "stranger", &office).await;
    assert!(matches!(&refused, Err(m) if m.contains("not a member")), "got {refused:?}");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_guest_sees_the_roster_too() {
    let kernel = create_test_kernel().await;
    member(&kernel, "gil", UserRole::Guest).await;
    member(&kernel, "ann", UserRole::Member).await;
    let office = node(&kernel, ROOT, "Office", "Ops").await;

    let (ids, _) = roster(&kernel, "gil", &office).await.expect("a guest with access may see who else has it");
    assert!(ids.contains(&"ann".to_string()));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn removing_someone_who_only_inherits_access_says_so() {
    let kernel = create_test_kernel().await;
    member(&kernel, "ann", UserRole::Member).await;
    let office = node(&kernel, ROOT, "Office", "Ops").await;

    let inherited = kernel.domain_operations.remove_user_from_domain(TEST_ADMIN_USER_ID, "ann", &office).await;
    let message = inherited.expect_err("removing an inherited member must not report a removal that did not happen").into_string();
    assert!(message.contains("through a level above"), "got {message}");

    // The control: someone listed on the office itself is removed as before.
    kernel
        .domain_operations
        .add_user_to_domain(TEST_ADMIN_USER_ID, "ann", &office, UserRole::Member)
        .await
        .expect("an admin may add ann to the office");
    kernel
        .domain_operations
        .remove_user_from_domain(TEST_ADMIN_USER_ID, "ann", &office)
        .await
        .expect("a direct member is removed");
}
