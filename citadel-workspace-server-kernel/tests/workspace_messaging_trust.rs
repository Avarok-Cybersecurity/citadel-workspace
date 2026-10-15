//! Who connects without asking: the workspace's messaging trust policy, a member's own
//! narrowing of it, and the server-side check a client asks before auto-accepting.
//!
//! Owner (2026-10-15): AllTrusted is the default, Slack-like; an admin may trust one branch or
//! nobody; a member may only make their own setting stricter. The check is the server's, so a
//! client never auto-accepts from its cached roster.
//!
//! No mocks: the real command processor, storage and broadcast channel. The tree is
//! `common::trust_test_utils`'s.
use citadel_workspace_types::messaging_trust::{
    MessagingTrustPolicy as Policy, MessagingTrustRequest as Req, WORKSPACE_ROOT_ID as ROOT,
};
use citadel_workspace_types::structs::UserRole;
use citadel_workspace_types::WorkspaceProtocolResponse;
use common::member_test_utils::insert_user_with_role;
use common::trust_test_utils::{check, on, refusal, set_mine, set_workspace, settings_after, tree};
use common::workspace_test_utils::{create_test_kernel, TEST_ADMIN_USER_ID};
use std::time::Duration;

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_workspace_with_no_stored_policy_trusts_everyone_in_it() {
    let kernel = create_test_kernel().await;
    tree(&kernel).await;
    let settings = settings_after(&kernel, "eve", Req::GetMessagingTrustSettings).await;
    assert_eq!(settings.workspace, Policy::AllTrusted);
    assert_eq!(settings.mine, None);
    assert_eq!(settings.effective_root.as_deref(), Some(ROOT));
    assert_eq!(check(&kernel, "eve", "sam").await, (true, true));
    assert_eq!(check(&kernel, "wes", "bob").await, (true, true));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn setting_the_policy_needs_the_permission_and_refuses_the_same_whatever_is_sent() {
    let kernel = create_test_kernel().await;
    tree(&kernel).await;
    let valid = refusal(
        &kernel,
        "eve",
        Req::SetWorkspaceMessagingTrust {
            policy: Policy::Strict,
        },
    )
    .await;
    let invalid = refusal(
        &kernel,
        "eve",
        Req::SetWorkspaceMessagingTrust {
            policy: on("no-such-node"),
        },
    )
    .await;
    assert_eq!(
        valid, invalid,
        "a refusal that varies with the input is an oracle"
    );
    assert_eq!(check(&kernel, "eve", "sam").await, (true, true));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_unknown_node_is_refused_and_a_set_policy_reaches_the_members() {
    let kernel = create_test_kernel().await;
    let t = tree(&kernel).await;
    let error = refusal(
        &kernel,
        TEST_ADMIN_USER_ID,
        Req::SetWorkspaceMessagingTrust {
            policy: on("no-such-node"),
        },
    )
    .await;
    assert!(error.contains("no-such-node"), "{error}");

    let mut rx = kernel.subscribe_broadcast();
    let settings = set_workspace(&kernel, on(&t.eng)).await;
    assert_eq!(settings.workspace, on(&t.eng));
    let mut heard = false;
    while let Ok(Ok(msg)) = tokio::time::timeout(Duration::from_millis(200), rx.recv()).await {
        heard |= matches!(&msg.response, WorkspaceProtocolResponse::Workspace(_));
    }
    assert!(heard, "members' clients must hear that the policy changed");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_trusted_branch_admits_its_descendants_and_refuses_a_sibling_branch() {
    let kernel = create_test_kernel().await;
    let t = tree(&kernel).await;
    set_workspace(&kernel, on(&t.eng)).await;
    assert_eq!(check(&kernel, "eve", "bob").await, (true, true));
    assert_eq!(check(&kernel, "bob", "eve").await, (true, true));
    assert_eq!(check(&kernel, "eve", "sam").await, (false, false));
    assert_eq!(
        check(&kernel, "eve", "wes").await,
        (false, false),
        "a workspace-level member reaches eng from above and is not within it"
    );

    set_workspace(&kernel, Policy::Strict).await;
    assert_eq!(check(&kernel, "eve", "bob").await, (false, false));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_member_narrows_their_own_trust_and_only_theirs() {
    let kernel = create_test_kernel().await;
    let t = tree(&kernel).await;
    let mine = settings_after(&kernel, "eve", set_mine(Some(on(&t.eng)))).await;
    assert_eq!(mine.effective_root.as_deref(), Some(t.eng.as_str()));
    assert_eq!(check(&kernel, "eve", "bob").await, (true, true));
    assert_eq!(
        check(&kernel, "eve", "sam").await,
        (false, true),
        "eve no longer takes sam unasked; sam's client still takes eve"
    );
    assert_eq!(check(&kernel, "sam", "eve").await, (true, false));

    settings_after(&kernel, "eve", set_mine(Some(Policy::Strict))).await;
    assert_eq!(check(&kernel, "eve", "bob").await, (false, true));
    let back = settings_after(&kernel, "eve", set_mine(None)).await;
    assert_eq!(back.effective_root.as_deref(), Some(ROOT));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_personal_setting_wider_than_the_workspace_is_refused() {
    let kernel = create_test_kernel().await;
    let t = tree(&kernel).await;
    set_workspace(&kernel, on(&t.eng)).await;
    for wider in [Policy::AllTrusted, on(&t.sales), on(ROOT)] {
        refusal(&kernel, "eve", set_mine(Some(wider))).await;
    }
    let narrower = settings_after(&kernel, "eve", set_mine(Some(on(&t.backend)))).await;
    assert_eq!(narrower.mine, Some(on(&t.backend)));

    set_workspace(&kernel, Policy::Strict).await;
    refusal(&kernel, "eve", set_mine(Some(on(&t.backend)))).await;
    settings_after(&kernel, "eve", set_mine(Some(Policy::Strict))).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn disjoint_workspace_and_personal_roots_trust_nobody() {
    let kernel = create_test_kernel().await;
    let t = tree(&kernel).await;
    set_workspace(&kernel, on(&t.eng)).await;
    settings_after(&kernel, "eve", set_mine(Some(on(&t.eng)))).await;
    // The admin moves the trust to another branch; eve's stored choice is now outside it.
    let settings = set_workspace(&kernel, on(&t.sales)).await;
    assert_eq!(settings.workspace, on(&t.sales));
    let eve = settings_after(&kernel, "eve", Req::GetMessagingTrustSettings).await;
    assert_eq!(eve.effective_root, None);
    assert_eq!(check(&kernel, "eve", "bob").await, (false, false));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn nobody_outside_the_workspace_is_trusted_either_way() {
    let kernel = create_test_kernel().await;
    tree(&kernel).await;
    insert_user_with_role(&kernel, "out", UserRole::Member).await;
    assert_eq!(check(&kernel, "out", "eve").await, (false, false));
    assert_eq!(check(&kernel, "eve", "out").await, (false, false));
    assert_eq!(check(&kernel, "eve", "nobody-at-all").await, (false, false));
    refusal(&kernel, "out", set_mine(Some(Policy::Strict))).await;
}
