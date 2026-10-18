//! A secure link opens a page of this app and nothing else, and only someone allowed to share
//! links, who can see what they are sharing, may make one.

use citadel_workspace_server_kernel::kernel::secure_links::target::{
    target_node_id, validate_target,
};
use citadel_workspace_types::secure_links::SecureLinksResponse;
use citadel_workspace_types::structs::{Permission, UserRole};
use common::member_test_utils::{member_holding, seed_role};
use common::secure_links_test_utils::{enrol, expires, links_kernel, members, try_create, HOUR_MS};

const REFUSED: [&str; 17] = [
    "",
    "https://evil.example/workspace",
    "http://localhost/workspace",
    "//evil.example/workspace",
    "/\\evil.example",
    "/workspace?next=\\evil.example",
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    "data:text/html,<script>",
    "/workspace\n",
    "/work\tspace",
    "/workspace ?nodeId=a",
    "/admin",
    "/groups/../workspace",
    "/groups/",
    "/workspace?nodeId=a&nodeId=b",
    "/workspace?nodeId=%zz",
];

const ACCEPTED: [&str; 6] = [
    "/workspace",
    "/workspace?nodeId=workspace-root&section=files&path=%2Fdocs",
    "/messages",
    "/directory",
    "/groups/abc-123_x",
    "/workspace?showP2P=true&p2pUser=bob#latest",
];

#[test]
fn only_paths_to_the_apps_own_routes_are_targets() {
    for target in REFUSED {
        assert!(
            validate_target(target).is_err(),
            "{target:?} must be refused"
        );
    }
    for target in ACCEPTED {
        assert!(
            validate_target(target).is_ok(),
            "{target:?} must be accepted"
        );
    }
    assert!(validate_target(&format!("/workspace?x={}", "a".repeat(2048))).is_err());
}

#[test]
fn a_workspace_target_names_the_node_it_opens() {
    assert_eq!(
        target_node_id("/workspace?section=files&nodeId=room%2D1").unwrap(),
        Some("room-1".to_string())
    );
    assert_eq!(target_node_id("/workspace").unwrap(), None);
    assert_eq!(
        target_node_id("/messages?nodeId=x").unwrap(),
        None,
        "only /workspace opens a node"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_bad_target_is_refused_when_the_link_is_made() {
    let kernel = links_kernel(50, 0).await;
    enrol(&kernel, "alice", UserRole::Member).await;
    for target in REFUSED {
        let answer = try_create(
            &kernel,
            "alice",
            target,
            members(&["bob"]),
            expires(HOUR_MS),
        )
        .await;
        assert!(answer.is_err(), "{target:?} was accepted: {answer:?}");
    }
    for target in ACCEPTED {
        let answer = try_create(
            &kernel,
            "alice",
            target,
            members(&["bob"]),
            expires(HOUR_MS),
        )
        .await;
        assert!(
            matches!(answer, Ok(SecureLinksResponse::Created { .. })),
            "{target:?}: {answer:?}"
        );
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn members_may_share_links_and_guests_may_not() {
    let kernel = links_kernel(50, 0).await;
    enrol(&kernel, "alice", UserRole::Member).await;
    enrol(&kernel, "gina", UserRole::Guest).await;
    enrol(&kernel, "barred", UserRole::Banned).await;
    let make = |user: &'static str| {
        try_create(
            &kernel,
            user,
            "/messages",
            members(&["bob"]),
            expires(HOUR_MS),
        )
    };
    assert!(matches!(
        make("alice").await,
        Ok(SecureLinksResponse::Created { .. })
    ));
    for user in ["gina", "barred", "stranger"] {
        let answer = make(user).await;
        assert!(
            matches!(&answer, Err(text) if text.contains("ShareSecureLinks")),
            "{user}: {answer:?}"
        );
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn nobody_shares_a_node_they_cannot_see() {
    let kernel = links_kernel(50, 0).await;
    // May share, may not view: a role an administrator could make.
    seed_role(&kernel, "sharer", 150, &[Permission::ShareSecureLinks]).await;
    member_holding(&kernel, "sam", "sharer").await;
    let node_link = try_create(
        &kernel,
        "sam",
        "/workspace?nodeId=workspace-root",
        members(&["bob"]),
        expires(HOUR_MS),
    )
    .await;
    assert!(
        matches!(&node_link, Err(text) if text.contains("something you can see")),
        "{node_link:?}"
    );
    // Where the server cannot tell what the target shows, the permission is what is required.
    let messages = try_create(
        &kernel,
        "sam",
        "/messages",
        members(&["bob"]),
        expires(HOUR_MS),
    )
    .await;
    assert!(
        matches!(messages, Ok(SecureLinksResponse::Created { .. })),
        "{messages:?}"
    );
}
