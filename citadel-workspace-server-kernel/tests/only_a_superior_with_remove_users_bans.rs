//! Who may ban whom: `RemoveUsers`, a target below the caller's own role, and never an Owner.
//!
//! The same rule removal and role changes follow (`ensure_may_act_on`). Every refusal sits
//! beside a permitted ban, so a rule that refused every ban would not pass.

use citadel_workspace_types::structs::Permission;
use common::bans_test_utils::{ban, unban};
use common::member_test_utils::{
    an_owner, insert_user_with_role, join_root, member_holding, seed_role, GateKernel as Kernel,
};
use common::roles_fixture::{ADMIN_ROLE_ID, MEMBER_ROLE_ID, OWNER_ROLE_ID};
use common::workspace_test_utils::{create_test_kernel, TEST_ADMIN_USER_ID};

/// A role between Member (200) and Admin (300) holding `RemoveUsers`.
const MODERATOR: &[Permission] = &[
    Permission::ViewContent,
    Permission::ViewMembers,
    Permission::RemoveUsers,
];

async fn a_member(kernel: &Kernel, id: &str) {
    insert_user_with_role(kernel, id, MEMBER_ROLE_ID).await;
    join_root(kernel, id).await;
}

async fn is_banned(kernel: &Kernel, id: &str) -> bool {
    kernel
        .domain_operations
        .backend_tx_manager
        .get_user(id)
        .await
        .expect("read")
        .expect("user")
        .banned
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_ban_without_remove_users_is_refused() {
    let kernel = create_test_kernel().await;
    a_member(&kernel, "pat").await;
    a_member(&kernel, "mal").await;

    let refused = ban(&kernel, "pat", "mal").await;
    assert!(
        refused.as_ref().is_err_and(|e| e.contains("RemoveUsers")),
        "a member without RemoveUsers banned someone: {refused:?}",
    );
    assert!(!is_banned(&kernel, "mal").await);

    seed_role(&kernel, "moderator", 250, MODERATOR).await;
    member_holding(&kernel, "mod", "moderator").await;
    ban(&kernel, "mod", "mal")
        .await
        .expect("RemoveUsers is enough to ban a member below");
    assert!(is_banned(&kernel, "mal").await);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_unban_without_remove_users_is_refused() {
    let kernel = create_test_kernel().await;
    a_member(&kernel, "pat").await;
    a_member(&kernel, "mal").await;
    ban(&kernel, TEST_ADMIN_USER_ID, "mal")
        .await
        .expect("an admin bans");

    assert!(unban(&kernel, "pat", "mal").await.is_err());
    assert!(is_banned(&kernel, "mal").await);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_ban_never_reaches_a_member_at_or_above_the_caller() {
    let kernel = create_test_kernel().await;
    seed_role(&kernel, "moderator", 250, MODERATOR).await;
    member_holding(&kernel, "mod", "moderator").await;
    member_holding(&kernel, "peer", "moderator").await;
    insert_user_with_role(&kernel, "boss", ADMIN_ROLE_ID).await;
    join_root(&kernel, "boss").await;

    for target in ["peer", "boss"] {
        let refused = ban(&kernel, "mod", target).await;
        assert!(
            refused.as_ref().is_err_and(|e| e.contains("not below")),
            "a moderator banned {target}, who is not below them: {refused:?}",
        );
        assert!(!is_banned(&kernel, target).await);
    }

    a_member(&kernel, "mal").await;
    ban(&kernel, "mod", "mal")
        .await
        .expect("a member below the moderator may be banned");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn nobody_bans_the_owner_or_themselves() {
    let kernel = create_test_kernel().await;
    an_owner(&kernel, "owner").await;

    let refused = ban(&kernel, TEST_ADMIN_USER_ID, "owner").await;
    assert!(refused.is_err(), "an admin banned the Owner: {refused:?}");
    assert!(!is_banned(&kernel, "owner").await);

    assert!(
        ban(&kernel, "owner", "owner").await.is_err(),
        "the Owner banned themselves"
    );
    assert!(!is_banned(&kernel, "owner").await);

    // The Owner of another workspace, banned by the root's Owner, who is above everyone.
    a_member(&kernel, "founder").await;
    let mut founder = kernel
        .domain_operations
        .backend_tx_manager
        .get_user("founder")
        .await
        .expect("read")
        .expect("founder");
    founder
        .workspace_roles
        .insert("ws-other".to_string(), OWNER_ROLE_ID.to_string());
    kernel
        .domain_operations
        .backend_tx_manager
        .insert_user("founder".to_string(), founder)
        .await
        .expect("write");
    let refused = ban(&kernel, "owner", "founder").await;
    assert!(
        refused
            .as_ref()
            .is_err_and(|e| e.contains("owns a workspace")),
        "an Owner was banned: {refused:?}",
    );

    a_member(&kernel, "mal").await;
    ban(&kernel, "owner", "mal")
        .await
        .expect("the Owner may ban a member");
}
