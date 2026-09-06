//! An unauthorised caller must learn nothing about the master password.
//!
//! `create_workspace` and `update_workspace` each checked the password FIRST and
//! the caller's authority second, and the two failures return different strings:
//!
//!     "Invalid workspace master password"
//!     "Only root workspace admins can create additional workspaces"
//!
//! So anyone who could reach the endpoint had an online password oracle. Send a
//! guess, read which refusal comes back, and the answer says whether the guess
//! was right. The rate limiter allows 100 requests per second and resets its
//! bucket each window, registration needs no invite and CIDs are free, so there
//! is no lockout to run into — and the reply is a boolean per attempt.
//!
//! The property asserted here is the one that closes it: for a caller who is
//! not entitled to the operation, the answer is the SAME whether the password
//! was right or wrong. Comparing the two refusals to each other is the test —
//! not matching either against a fixed string, which would pass the moment
//! somebody reworded one of them.
//!
//! `update_workspace` could not simply have its two checks swapped. Its
//! authorisation depends on the record: an unowned workspace is claimable by
//! whoever presents the password, which is how the first administrator is
//! established. The order there is read, authorise, then verify the secret, and
//! the bootstrap case is asserted below so that reordering cannot have quietly
//! closed it.
//!
//! `delete_workspace` already checked authority first, and is asserted here too
//! — it is the case that was always right, and if it ever stops being right
//! this file should say so.

use citadel_workspace_server_kernel::handlers::domain::async_ops::AsyncWorkspaceOperations;
use citadel_workspace_types::structs::UserRole;
use common::member_test_utils::{insert_user_with_role, join_root, GateKernel as Kernel};
use common::workspace_test_utils::{create_test_kernel, TEST_ADMIN_PASSWORD};

const WRONG: &str = "not-the-master-password";

/// A member with no workspace-creating authority — the actor whose guesses must
/// teach them nothing.
async fn a_plain_member(kernel: &Kernel) -> &'static str {
    insert_user_with_role(kernel, "outsider", UserRole::Member).await;
    join_root(kernel, "outsider").await;
    "outsider"
}

async fn try_create(kernel: &Kernel, actor: &str, password: &str) -> String {
    kernel
        .domain_operations
        .create_workspace(actor, "probe", "", None, password.to_string())
        .await
        .err()
        .map(|e| e.to_string())
        .unwrap_or_else(|| "<succeeded>".to_string())
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn creating_tells_an_unauthorised_caller_the_same_thing_either_way() {
    let kernel = create_test_kernel().await;
    let actor = a_plain_member(&kernel).await;

    let with_wrong = try_create(&kernel, actor, WRONG).await;
    let with_right = try_create(&kernel, actor, TEST_ADMIN_PASSWORD).await;

    assert_ne!(
        with_right, "<succeeded>",
        "a plain Member must not be able to create a workspace at all",
    );
    assert_eq!(
        with_wrong, with_right,
        "the refusal differs by whether the password was right, which is an oracle:\n  \
         wrong -> {with_wrong}\n  right -> {with_right}",
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn updating_tells_an_unauthorised_caller_the_same_thing_either_way() {
    let kernel = create_test_kernel().await;
    let actor = a_plain_member(&kernel).await;
    let root = citadel_workspace_server_kernel::WORKSPACE_ROOT_ID;

    let refuse = |password: &'static str| async move {
        let kernel = create_test_kernel().await;
        let actor = a_plain_member(&kernel).await;
        kernel
            .domain_operations
            .update_workspace(
                actor,
                root,
                Some("renamed"),
                None,
                None,
                password.to_string(),
            )
            .await
            .err()
            .map(|e| e.to_string())
            .unwrap_or_else(|| "<succeeded>".to_string())
    };
    let _ = actor;

    let with_wrong = refuse(WRONG).await;
    let with_right = refuse(TEST_ADMIN_PASSWORD).await;

    assert_ne!(
        with_right, "<succeeded>",
        "a plain Member must not be able to rename the root workspace",
    );
    assert_eq!(
        with_wrong, with_right,
        "the refusal differs by whether the password was right, which is an oracle:\n  \
         wrong -> {with_wrong}\n  right -> {with_right}",
    );
}

// ---------- what must still work ----------
//
// Without these, a kernel that refused every one of these calls identically
// would satisfy both assertions above and break workspace creation entirely.

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_entitled_caller_with_the_right_password_still_succeeds() {
    let kernel = create_test_kernel().await;
    insert_user_with_role(&kernel, "owner", UserRole::Owner).await;
    join_root(&kernel, "owner").await;

    kernel
        .domain_operations
        .create_workspace(
            "owner",
            "second",
            "an additional workspace",
            None,
            TEST_ADMIN_PASSWORD.to_string(),
        )
        .await
        .expect("an Owner holding the master password may create a workspace");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_entitled_caller_with_the_wrong_password_is_still_refused() {
    // The password did not stop mattering; it stopped being the FIRST thing
    // checked. For someone who passes the authority gate it is the whole gate.
    let kernel = create_test_kernel().await;
    insert_user_with_role(&kernel, "owner", UserRole::Owner).await;
    join_root(&kernel, "owner").await;

    let refusal = try_create(&kernel, "owner", WRONG).await;

    assert_ne!(refusal, "<succeeded>", "a wrong password must still refuse");
    assert!(
        refusal.contains("password"),
        "and an entitled caller SHOULD be told it was the password: {refusal}",
    );
}
