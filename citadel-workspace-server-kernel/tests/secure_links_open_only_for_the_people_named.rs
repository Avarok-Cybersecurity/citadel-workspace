//! A secure link opens for the people its grants name and for nobody else, and every refusal is
//! the same answer. A one-time link is spent by the first person it admits, never by anyone else,
//! and only once however many open it at the same moment.
//!
//! Driven through `process_command_with_user`, the dispatch every client request takes.

use citadel_workspace_server_kernel::WORKSPACE_ROOT_ID;
use citadel_workspace_types::roles::GUEST_ROLE_ID;
use citadel_workspace_types::secure_links::{LinkGrant, SecureLinksResponse};
use citadel_workspace_types::structs::UserRole;
use common::secure_links_test_utils::{
    create, enrol, expires, links_kernel, members, one_time, opened, resolve, HOUR_MS,
};

const TARGET: &str = "/workspace?nodeId=workspace-root";

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn each_kind_of_grant_admits_its_people_and_refuses_the_rest() {
    let kernel = links_kernel(50, 0).await;
    for (id, role) in [
        ("alice", UserRole::Member),
        ("bob", UserRole::Member),
        ("carol", UserRole::Member),
        ("gina", UserRole::Guest),
        ("barred", UserRole::Banned),
    ] {
        enrol(&kernel, id, role).await;
    }
    let group = LinkGrant::GroupSnapshot {
        group_id: "g-1".to_string(),
        members: vec!["bob".to_string()],
    };
    // (grant, who it admits, who it refuses). "stranger" has no account; "barred" is banned.
    let cases: Vec<(Vec<LinkGrant>, Vec<&str>, Vec<&str>)> = vec![
        (
            members(&["bob"]),
            vec!["bob"],
            vec!["carol", "gina", "barred", "stranger"],
        ),
        (
            vec![LinkGrant::Roles(vec![GUEST_ROLE_ID.to_string()])],
            vec!["gina"],
            vec!["bob", "carol", "barred", "stranger"],
        ),
        (
            vec![LinkGrant::NodeViewers(WORKSPACE_ROOT_ID.to_string())],
            vec!["bob", "carol", "gina"],
            vec!["barred", "stranger"],
        ),
        (
            vec![LinkGrant::NodeViewers("no-such-node".to_string())],
            vec![],
            vec!["bob", "carol", "gina", "barred", "stranger"],
        ),
        (
            vec![LinkGrant::Workspace],
            vec!["bob", "carol", "gina"],
            vec!["barred", "stranger"],
        ),
        (
            vec![group],
            vec!["bob"],
            vec!["carol", "gina", "barred", "stranger"],
        ),
    ];
    for (grants, admitted, refused) in cases {
        let (_, token) = create(&kernel, "alice", TARGET, grants.clone(), expires(HOUR_MS)).await;
        for visitor in admitted {
            let answer = resolve(&kernel, visitor, &token).await;
            assert!(
                opened(&answer, TARGET),
                "{grants:?} must admit {visitor}: {answer:?}"
            );
        }
        for visitor in refused {
            let answer = resolve(&kernel, visitor, &token).await;
            assert_eq!(
                answer,
                SecureLinksResponse::LinkUnavailable,
                "{grants:?} must refuse {visitor}"
            );
        }
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_one_time_link_is_spent_only_by_someone_it_admits() {
    let kernel = links_kernel(50, 0).await;
    for id in ["alice", "bob", "carol"] {
        enrol(&kernel, id, UserRole::Member).await;
    }
    let (_, token) = create(
        &kernel,
        "alice",
        TARGET,
        members(&["bob"]),
        one_time(HOUR_MS),
    )
    .await;

    assert_eq!(
        resolve(&kernel, "carol", &token).await,
        SecureLinksResponse::LinkUnavailable
    );
    assert_eq!(
        resolve(&kernel, "carol", &token).await,
        SecureLinksResponse::LinkUnavailable,
        "a refused visitor, however often, does not spend it"
    );
    assert!(
        opened(&resolve(&kernel, "bob", &token).await, TARGET),
        "still there for bob"
    );
    assert_eq!(
        resolve(&kernel, "bob", &token).await,
        SecureLinksResponse::LinkUnavailable,
        "spent by its first use"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn opened_at_once_a_one_time_link_opens_exactly_once() {
    let kernel = links_kernel(50, 0).await;
    for id in ["alice", "bob"] {
        enrol(&kernel, id, UserRole::Member).await;
    }
    for _ in 0..5 {
        let (_, token) = create(
            &kernel,
            "alice",
            TARGET,
            members(&["bob"]),
            one_time(HOUR_MS),
        )
        .await;
        let opens: Vec<_> = (0..8)
            .map(|_| {
                let (kernel, token) = (kernel.clone(), token.clone());
                tokio::spawn(async move { resolve(&kernel, "bob", &token).await })
            })
            .collect();
        let mut successes = 0;
        for open in opens {
            if opened(&open.await.expect("task"), TARGET) {
                successes += 1;
            }
        }
        assert_eq!(successes, 1, "eight concurrent opens of a one-time link");
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn unknown_expired_spent_and_not_granted_are_one_answer() {
    let kernel = links_kernel(50, 0).await;
    for id in ["alice", "bob", "carol"] {
        enrol(&kernel, id, UserRole::Member).await;
    }
    let (_, expired) = create(&kernel, "alice", TARGET, members(&["bob"]), expires(1)).await;
    let (_, spent) = create(
        &kernel,
        "alice",
        TARGET,
        members(&["bob"]),
        one_time(HOUR_MS),
    )
    .await;
    let (_, not_for_carol) = create(
        &kernel,
        "alice",
        TARGET,
        members(&["bob"]),
        expires(HOUR_MS),
    )
    .await;
    assert!(opened(&resolve(&kernel, "bob", &spent).await, TARGET));
    tokio::time::sleep(std::time::Duration::from_millis(20)).await;

    let answers = [
        resolve(
            &kernel,
            "bob",
            "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        )
        .await,
        resolve(&kernel, "bob", "not even the right shape").await,
        resolve(&kernel, "bob", &expired).await,
        resolve(&kernel, "bob", &spent).await,
        resolve(&kernel, "carol", &not_for_carol).await,
    ];
    let wire: Vec<String> = answers
        .iter()
        .map(|a| serde_json::to_string(a).expect("serialises"))
        .collect();
    for (answer, json) in answers.iter().zip(&wire) {
        assert_eq!(*answer, SecureLinksResponse::LinkUnavailable);
        assert_eq!(
            json, &wire[0],
            "every refusal is byte-identical on the wire"
        );
    }
}
