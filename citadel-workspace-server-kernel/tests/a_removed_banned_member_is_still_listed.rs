//! A banned member removed from the workspace is still listed as banned, so the ban can be found
//! and lifted: the roster no longer names them, and `ListBanned` does.
//!
//! The listing is asserted beside the roster that dropped them, and beside a caller without
//! `RemoveUsers` being refused, so a listing that read the roster, or answered everyone, fails.

use citadel_workspace_types::structs::User;
use citadel_workspace_types::{WorkspaceProtocolRequest as Req, WorkspaceProtocolResponse as Res};
use common::bans_test_utils::{answer, ban, unban};
use common::member_test_utils::{insert_user_with_role, join_root, GateKernel as Kernel};
use common::roles_fixture::MEMBER_ROLE_ID;
use common::workspace_test_utils::{create_test_kernel, TEST_ADMIN_USER_ID};

const ROOT: &str = citadel_workspace_server_kernel::WORKSPACE_ROOT_ID;

async fn a_member(kernel: &Kernel, id: &str) {
    insert_user_with_role(kernel, id, MEMBER_ROLE_ID).await;
    join_root(kernel, id).await;
}

async fn banned_ids(kernel: &Kernel, actor: &str) -> Result<Vec<String>, String> {
    match answer(kernel, actor, Req::ListBanned).await? {
        Res::BannedMembers { members } => Ok(members.into_iter().map(|u: User| u.id).collect()),
        other => panic!("ListBanned answered {other:?}"),
    }
}

async fn on_roster(kernel: &Kernel, id: &str) -> bool {
    let domain_id = Some(ROOT.to_string());
    match answer(kernel, TEST_ADMIN_USER_ID, Req::ListMembers { domain_id }).await {
        Ok(Res::Members { members, .. }) => members.iter().any(|m| m.id == id),
        other => panic!("ListMembers answered {other:?}"),
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_removed_banned_member_is_listed_until_unbanned() {
    let kernel = create_test_kernel().await;
    a_member(&kernel, "mal").await;
    a_member(&kernel, "kit").await;
    assert_eq!(banned_ids(&kernel, TEST_ADMIN_USER_ID).await, Ok(vec![]));

    ban(&kernel, TEST_ADMIN_USER_ID, "mal").await.expect("ban");
    let domain_id = Some(ROOT.to_string());
    let user_id = "mal".to_string();
    answer(
        &kernel,
        TEST_ADMIN_USER_ID,
        Req::RemoveMember { user_id, domain_id },
    )
    .await
    .expect("remove");
    assert!(
        !on_roster(&kernel, "mal").await,
        "precondition: the roster no longer names them"
    );
    assert!(on_roster(&kernel, "kit").await);

    assert_eq!(
        banned_ids(&kernel, TEST_ADMIN_USER_ID).await,
        Ok(vec!["mal".to_string()]),
        "the removed, banned member is listed, and the member in good standing is not",
    );
    let refused = banned_ids(&kernel, "kit").await;
    assert!(
        refused.as_ref().is_err_and(|e| e.contains("RemoveUsers")),
        "a member without RemoveUsers is refused the list: {refused:?}",
    );

    unban(&kernel, TEST_ADMIN_USER_ID, "mal")
        .await
        .expect("unban");
    assert_eq!(banned_ids(&kernel, TEST_ADMIN_USER_ID).await, Ok(vec![]));
    assert!(on_roster(&kernel, "mal").await, "the unban readmits them");
}
