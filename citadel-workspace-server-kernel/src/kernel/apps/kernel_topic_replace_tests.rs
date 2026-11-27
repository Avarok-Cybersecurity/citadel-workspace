//! A topic's group ends when its last member leaves; its record must not outlive it. A member
//! told the recorded group is gone records a new one with `replaces`, and only that swap moves a
//! record: a claim without it, or one naming a group that is no longer the recorded one, leaves
//! the record as it is.

use super::kernel_peer_tests::{consent, pool};
use super::test_ihttp::refusal;
use super::test_runtime::ask_on;
use super::test_support::Kernel;
use citadel_workspace_types::apps_install::AppsRefusal;
use citadel_workspace_types::apps_protocol::AppsRequest;
use citadel_workspace_types::apps_responses::AppsResponse;

async fn topic_group(
    kernel: &Kernel,
    who: &str,
    id: &str,
    claim: Option<&str>,
    replaces: Option<&str>,
) -> AppsResponse {
    let request = AppsRequest::TopicGroup {
        install_id: id.into(),
        topic: "pool".into(),
        claim: claim.map(str::to_string),
        replaces: replaces.map(str::to_string),
    };
    ask_on(kernel, who, None, request).await
}

fn group_key(answer: &AppsResponse) -> Option<&str> {
    match answer {
        AppsResponse::TopicGroup { group_key, .. } => group_key.as_deref(),
        other => panic!("{other:?}"),
    }
}

async fn recorded_by_alice() -> (Kernel, String) {
    let (kernel, id, _bob) = pool().await;
    consent(&kernel, "alice", &id, true).await;
    consent(&kernel, "bob", &id, true).await;
    let first = topic_group(&kernel, "alice", &id, Some("group-1"), None).await;
    assert_eq!(group_key(&first), Some("group-1"));
    (kernel, id)
}

#[tokio::test]
async fn an_ended_group_is_replaced_by_the_first_member_to_say_so() {
    let (kernel, id) = recorded_by_alice().await;
    let alice = topic_group(&kernel, "alice", &id, Some("group-2"), Some("group-1")).await;
    assert_eq!(
        group_key(&alice),
        Some("group-2"),
        "the ended group's record moves"
    );
    let bob = topic_group(&kernel, "bob", &id, Some("group-3"), Some("group-1")).await;
    assert_eq!(
        group_key(&bob),
        Some("group-2"),
        "a second replacement of the same ended group joins the first's"
    );
    let read = topic_group(&kernel, "bob", &id, None, None).await;
    assert_eq!(group_key(&read), Some("group-2"));
}

#[tokio::test]
async fn a_claim_that_names_no_ended_group_moves_nothing() {
    let (kernel, id) = recorded_by_alice().await;
    let plain = topic_group(&kernel, "bob", &id, Some("group-2"), None).await;
    assert_eq!(group_key(&plain), Some("group-1"), "the first claim stands");
    let stale = topic_group(&kernel, "bob", &id, Some("group-2"), Some("group-0")).await;
    assert_eq!(
        group_key(&stale),
        Some("group-1"),
        "a group that is not the recorded one replaces nothing"
    );
}

#[tokio::test]
async fn a_replacement_must_say_what_it_records() {
    let (kernel, id) = recorded_by_alice().await;
    let bare = topic_group(&kernel, "bob", &id, None, Some("group-1")).await;
    assert!(matches!(refusal(&bare), Some(AppsRefusal::Limit(_))));
    let empty = topic_group(&kernel, "bob", &id, Some("group-2"), Some("")).await;
    assert!(matches!(refusal(&empty), Some(AppsRefusal::Limit(_))));
    let read = topic_group(&kernel, "bob", &id, None, None).await;
    assert_eq!(group_key(&read), Some("group-1"));
}
