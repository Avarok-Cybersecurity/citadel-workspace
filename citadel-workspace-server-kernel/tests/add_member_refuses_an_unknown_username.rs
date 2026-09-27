//! A refused `AddMember` leaves nothing behind.
//!
//! `add_user_to_domain` used to mint a `User` for any name it was handed, so
//! the refusal has to come before that write, and has to say which name was
//! unknown. The account source itself is proven against the production server
//! in `add_member_requires_a_registered_account.rs`; this file pins the gate's
//! placement and its side effects through the protocol handler.
use citadel_workspace_server_kernel::WORKSPACE_ROOT_ID;
use citadel_workspace_types::structs::UserRole;
use citadel_workspace_types::{WorkspaceProtocolRequest, WorkspaceProtocolResponse};
use common::async_test_helpers::execute_command;
use common::member_test_utils::{insert_user_with_role, GateKernel as Kernel};
use common::workspace_test_utils::create_test_kernel;

fn add(user_id: &str) -> WorkspaceProtocolRequest {
    WorkspaceProtocolRequest::AddMember {
        user_id: user_id.to_string(),
        domain_id: None,
        role: UserRole::Member,
        metadata: None,
    }
}

async fn root_members(kernel: &Kernel) -> Vec<String> {
    kernel
        .domain_operations
        .backend_tx_manager
        .get_workspace(WORKSPACE_ROOT_ID)
        .await
        .expect("read workspace")
        .expect("root workspace exists")
        .members
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_unknown_username_is_refused_by_name_and_creates_nothing() {
    let kernel = create_test_kernel().await;

    let response = execute_command(&kernel, add("nobody_by_this_name"))
        .await
        .expect("the handler answers");

    assert!(
        matches!(
            &response,
            WorkspaceProtocolResponse::Error(m)
                if m == "Failed to add member: No account named 'nobody_by_this_name' exists on this workspace"
        ),
        "got {response:?}"
    );
    let record = kernel
        .domain_operations
        .backend_tx_manager
        .get_user("nobody_by_this_name")
        .await
        .expect("read user");
    assert!(record.is_none(), "a refused add minted {record:?}");
    assert!(
        !root_members(&kernel)
            .await
            .contains(&"nobody_by_this_name".to_string()),
        "a refused add still joined the workspace"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_known_account_is_still_added() {
    let kernel = create_test_kernel().await;
    insert_user_with_role(&kernel, "carol", UserRole::Guest).await;

    let response = execute_command(&kernel, add("carol"))
        .await
        .expect("the handler answers");

    assert!(
        matches!(&response, WorkspaceProtocolResponse::Success(m) if m == "Member added successfully"),
        "got {response:?}"
    );
    assert!(root_members(&kernel).await.contains(&"carol".to_string()));
}
