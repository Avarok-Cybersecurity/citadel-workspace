//! A wrong caller and a wrong password must be refused the same way.
//!
//! `update_workspace` verified the master password FIRST, before anything
//! looked at who was asking. The two refusals differ:
//!
//!   "Invalid workspace master access password"  -> wrong guess
//!   "Permission denied: only an admin or ..."   -> right guess, wrong caller
//!
//! So every account on the server had a permanent yes/no oracle on the master
//! password, testable one guess per request. With open enrolment -- any
//! account reaching the server port is inserted as a member -- that is anyone
//! who can register, and the rate limiter is per CID, so the guess rate scales
//! with the number of accounts created rather than being bounded by one.
//!
//! Checking authorization first makes the two cases indistinguishable to a
//! caller who is neither owner nor admin.
//!
//! The BOOTSTRAP case is deliberately different and stays that way: for an
//! unowned workspace the password IS the authorization, because that is how
//! the first owner claims it. The test below pins that too, so a future
//! tightening cannot quietly close the claim path.

use citadel_workspace_server_kernel::handlers::domain::async_ops::async_workspace_ops::AsyncWorkspaceOperations;
use citadel_workspace_types::structs::UserRole;
use common::member_test_utils::{insert_user_with_role, join_root};
use common::workspace_test_utils::{create_test_kernel, TEST_ADMIN_PASSWORD};

const ROOT: &str = citadel_workspace_server_kernel::WORKSPACE_ROOT_ID;
const OUTSIDER: &str = "outsider";

#[tokio::test]
async fn a_non_owner_is_refused_identically_whatever_password_they_send() {
    let kernel = create_test_kernel().await;

    // An enrolled account that is neither owner nor admin — exactly what open
    // enrolment produces for anyone who registers.
    insert_user_with_role(&kernel, OUTSIDER, UserRole::Member).await;
    join_root(&kernel, OUTSIDER).await;

    let with_wrong = kernel
        .domain_operations
        .update_workspace(
            OUTSIDER,
            ROOT,
            Some("renamed"),
            None,
            None,
            "definitely-not-the-password".to_string(),
        )
        .await
        .expect_err("a non-owner must not be able to update the workspace");

    let with_right = kernel
        .domain_operations
        .update_workspace(
            OUTSIDER,
            ROOT,
            Some("renamed"),
            None,
            None,
            TEST_ADMIN_PASSWORD.to_string(),
        )
        .await
        .expect_err("a non-owner must not be able to update the workspace");

    // Compared to EACH OTHER, not to a fixed string: the property is
    // indistinguishability, not any particular wording, so a reword cannot
    // silently pass this while re-opening the oracle.
    assert_eq!(
        format!("{with_wrong}"),
        format!("{with_right}"),
        "the refusal must not reveal whether the password was right",
    );

    assert!(
        !format!("{with_right}").contains("password"),
        "a non-owner's refusal must not mention the password at all: {with_right}",
    );
}
