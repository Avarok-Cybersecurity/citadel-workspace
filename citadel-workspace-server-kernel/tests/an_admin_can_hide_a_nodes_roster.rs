//! An admin can switch off "Members can see each other" on a node.
//!
//! The switch is the node's `default_permissions.view_members`, which was
//! written to every node and read by nothing. Off, it takes `ViewMembers` away
//! from every non-admin on that node and on every node below it. Admins and
//! owners still see the list. It is the only node default that restricts
//! anything, and it restricts `ListMembers` alone.
//!
//! Real: the kernel, its command processor and the in-memory backend. Every
//! request goes through `process_command_with_user`, as the named account.
use citadel_workspace_server_kernel::handlers::domain::node_ops::AsyncNodeOperations;
use citadel_workspace_server_kernel::kernel::command_processor::async_process_command::process_command_with_user;
use citadel_workspace_types::structs::{NodeEntityType, UserRole};
use citadel_workspace_types::{WorkspaceProtocolRequest, WorkspaceProtocolResponse};
use common::member_test_utils::{insert_user_with_role, join_root, GateKernel as Kernel};
use common::workspace_test_utils::{create_test_kernel, TEST_ADMIN_USER_ID};

const ROOT: &str = citadel_workspace_server_kernel::WORKSPACE_ROOT_ID;

async fn node(kernel: &Kernel, parent: &str, kind: &str, name: &str) -> String {
    kernel
        .domain_operations
        .create_node(
            TEST_ADMIN_USER_ID,
            Some(parent),
            &NodeEntityType::Child(kind.to_string()),
            name,
            "",
        )
        .await
        .expect("an admin may create the node")
        .id
}

async fn member(kernel: &Kernel, id: &str, role: UserRole) {
    insert_user_with_role(kernel, id, role).await;
    join_root(kernel, id).await;
}

async fn set_visible(
    kernel: &Kernel,
    actor: &str,
    node_id: &str,
    visible: bool,
) -> WorkspaceProtocolResponse {
    let request = WorkspaceProtocolRequest::SetMembersVisible {
        node_id: node_id.to_string(),
        visible,
    };
    process_command_with_user(kernel, &request, actor)
        .await
        .expect("dispatch")
}

/// What `viewer` gets back for `domain`'s roster.
#[derive(Debug, PartialEq)]
enum Roster {
    Listed(usize),
    Hidden(String),
    Refused(String),
}

async fn roster(kernel: &Kernel, viewer: &str, domain: &str) -> Roster {
    let request = WorkspaceProtocolRequest::ListMembers {
        domain_id: Some(domain.to_string()),
    };
    match process_command_with_user(kernel, &request, viewer)
        .await
        .expect("dispatch")
    {
        WorkspaceProtocolResponse::Members { members, .. } => Roster::Listed(members.len()),
        WorkspaceProtocolResponse::MembersHidden { domain_id } => Roster::Hidden(domain_id),
        WorkspaceProtocolResponse::Error(message) => Roster::Refused(message),
        other => panic!("expected a roster answer, got {other:?}"),
    }
}

async fn stored_flag(kernel: &Kernel, node_id: &str) -> bool {
    kernel
        .domain_operations
        .backend_tx_manager
        .get_all_nodes_shared()
        .await
        .expect("read nodes")
        .get(node_id)
        .expect("the node exists")
        .default_permissions
        .view_members
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn switching_it_off_hides_the_roster_from_a_member() {
    let kernel = create_test_kernel().await;
    member(&kernel, "ann", UserRole::Member).await;
    let office = node(&kernel, ROOT, "Office", "Ops").await;
    // The control: before the switch, ann sees the list.
    assert!(matches!(
        roster(&kernel, "ann", &office).await,
        Roster::Listed(n) if n > 0
    ));

    let answer = set_visible(&kernel, TEST_ADMIN_USER_ID, &office, false).await;
    assert!(
        matches!(&answer, WorkspaceProtocolResponse::Node(n) if !n.default_permissions.view_members),
        "an admin's switch must be stored and echoed: {answer:?}"
    );
    assert_eq!(
        roster(&kernel, "ann", &office).await,
        Roster::Hidden(office.clone()),
        "a hidden roster is said to be hidden, not listed empty"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn it_reaches_every_node_below_and_no_sibling() {
    let kernel = create_test_kernel().await;
    member(&kernel, "ann", UserRole::Member).await;
    let office = node(&kernel, ROOT, "Office", "Ops").await;
    let room = node(&kernel, &office, "Room", "Standup").await;
    let sibling = node(&kernel, ROOT, "Office", "Sales").await;
    set_visible(&kernel, TEST_ADMIN_USER_ID, &office, false).await;

    assert_eq!(
        roster(&kernel, "ann", &room).await,
        Roster::Hidden(room.clone())
    );
    assert!(
        matches!(roster(&kernel, "ann", &sibling).await, Roster::Listed(_)),
        "an office beside the hidden one keeps its roster"
    );
    assert!(
        matches!(roster(&kernel, "ann", ROOT).await, Roster::Listed(_)),
        "the level above keeps its roster"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn admins_and_owners_still_see_it() {
    let kernel = create_test_kernel().await;
    member(&kernel, "olga", UserRole::Owner).await;
    let office = node(&kernel, ROOT, "Office", "Ops").await;
    let room = node(&kernel, &office, "Room", "Standup").await;
    set_visible(&kernel, TEST_ADMIN_USER_ID, &office, false).await;

    for viewer in [TEST_ADMIN_USER_ID, "olga"] {
        assert!(
            matches!(roster(&kernel, viewer, &room).await, Roster::Listed(n) if n > 0),
            "{viewer} is unaffected by the switch"
        );
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn switching_it_back_on_restores_the_roster() {
    let kernel = create_test_kernel().await;
    member(&kernel, "ann", UserRole::Member).await;
    let office = node(&kernel, ROOT, "Office", "Ops").await;
    set_visible(&kernel, TEST_ADMIN_USER_ID, &office, false).await;
    set_visible(&kernel, TEST_ADMIN_USER_ID, &office, true).await;

    assert!(stored_flag(&kernel, &office).await);
    assert!(matches!(
        roster(&kernel, "ann", &office).await,
        Roster::Listed(_)
    ));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn only_an_admin_may_set_it() {
    let kernel = create_test_kernel().await;
    member(&kernel, "ann", UserRole::Member).await;
    member(&kernel, "olga", UserRole::Owner).await;
    let office = node(&kernel, ROOT, "Office", "Ops").await;

    for actor in ["ann", "olga"] {
        let answer = set_visible(&kernel, actor, &office, false).await;
        assert!(
            matches!(&answer, WorkspaceProtocolResponse::Error(m) if m.contains("Permission denied")),
            "{actor} is not an admin and must be refused: {answer:?}"
        );
        assert!(
            stored_flag(&kernel, &office).await,
            "{actor}'s refused switch must not be stored"
        );
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_stranger_is_refused_before_learning_anything() {
    let kernel = create_test_kernel().await;
    insert_user_with_role(&kernel, "stranger", UserRole::Member).await;
    let office = node(&kernel, ROOT, "Office", "Ops").await;
    set_visible(&kernel, TEST_ADMIN_USER_ID, &office, false).await;

    assert!(
        matches!(roster(&kernel, "stranger", &office).await, Roster::Refused(m) if m.contains("not a member")),
        "a non-member gets the refusal, not the news that the list is hidden"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_missing_node_is_not_switched() {
    let kernel = create_test_kernel().await;
    let answer = set_visible(&kernel, TEST_ADMIN_USER_ID, "no-such-node", false).await;
    assert!(
        matches!(&answer, WorkspaceProtocolResponse::Error(m) if m.contains("not found")),
        "got {answer:?}"
    );
}
