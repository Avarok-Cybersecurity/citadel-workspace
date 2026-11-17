//! `storage.node.authored` through the kernel (Calendar design §3.3.1): a viewer posts on a node
//! without `EditMdx`, only under their own name; anyone who may view the node reads every
//! author's posts; each author's namespace keeps its own quota; the scope bounds where; writes
//! are announced to the node's viewers; a purge removes every author's keys and the roster.

use super::kernel_call_tests::{get, set, value};
use super::kernel_purge_tests::{storage_keys, uninstall};
use super::storage::{KV_MAX_KEYS, KV_MAX_SET_MANY};
use super::test_manifests::*;
use super::test_runtime::*;
use crate::kernel::async_kernel::BroadcastAudience;
use crate::WORKSPACE_ROOT_ID;
use citadel_app_sdk_types::calls::*;
use citadel_app_sdk_types::ops::StorageOps;
use citadel_app_sdk_types::{HostCall, HostReply, Refused};
use citadel_workspace_types::apps::{Capability, InstallScope};
use citadel_workspace_types::apps_responses::AppsResponse;
use citadel_workspace_types::WorkspaceProtocolResponse;

const CAP: &[Capability] = &[Capability::StorageNodeAuthored];

fn authored(node: &str, author: Option<&str>) -> KvBackend {
    KvBackend::NodeAuthored {
        node_id: node.into(),
        author: author.map(Into::into),
    }
}

fn delete(backend: KvBackend, key: &str) -> HostCall {
    HostCall::Storage(StorageOps::KvDelete(KvDelete {
        backend,
        key: key.into(),
    }))
}

fn mine(node: &str) -> KvBackend {
    authored(node, None)
}

fn across(node: &str, cursor: Option<String>) -> HostCall {
    HostCall::Storage(StorageOps::KvListAuthored(KvListAuthored {
        node_id: node.into(),
        prefix: "cal/".into(),
        cursor,
    }))
}

async fn listed(
    kernel: &super::test_support::Kernel,
    user: &str,
    id: &str,
) -> Vec<(String, String)> {
    let reply: HostReply<AuthoredPage> = call(kernel, user, id, &across("room", None)).await;
    let page = reply.into_result().expect("listed");
    page.entries
        .into_iter()
        .map(|e| (e.author, e.key))
        .collect()
}

#[tokio::test]
async fn a_viewer_without_edit_mdx_posts_on_a_node_and_everyone_reads_it() {
    let kernel = workspace_serving(wasm(1, 4096)).await;
    let id = install(&kernel, "boss", InstallScope::Workspace, CAP).await;
    let posted: HostReply<()> = call(
        &kernel,
        "alice",
        &id,
        &set(mine("room"), "cal/rsvp/1", b"yes"),
    )
    .await;
    assert_eq!(posted, HostReply::Ok(()));
    let by_bob = call(
        &kernel,
        "bob",
        &id,
        &get(authored("room", Some("alice")), "cal/rsvp/1"),
    )
    .await;
    assert_eq!(value(by_bob), Some(b"yes".to_vec()));
    let bobs_own = call(&kernel, "bob", &id, &get(mine("room"), "cal/rsvp/1")).await;
    assert_eq!(value(bobs_own), None);
}

#[tokio::test]
async fn a_write_under_another_author_s_name_is_refused_and_lands_nowhere() {
    let kernel = workspace_serving(wasm(1, 4096)).await;
    let id = install(&kernel, "boss", InstallScope::Workspace, CAP).await;
    let forged = set(authored("room", Some("bob")), "cal/rsvp/1", b"no");
    let reply: HostReply<()> = call(&kernel, "alice", &id, &forged).await;
    assert_eq!(reply, HostReply::Refused(Refused::Policy("author".into())));
    let bobs = call(&kernel, "bob", &id, &get(mine("room"), "cal/rsvp/1")).await;
    assert_eq!(value(bobs), None);
    let deleted = delete(authored("room", Some("bob")), "cal/rsvp/1");
    let reply: HostReply<()> = call(&kernel, "alice", &id, &deleted).await;
    assert_eq!(reply, HostReply::Refused(Refused::Policy("author".into())));
}

#[tokio::test]
async fn a_listing_across_authors_names_each_key_s_author_and_drops_one_who_left() {
    let kernel = workspace_serving(wasm(1, 4096)).await;
    let id = install(&kernel, "boss", InstallScope::Workspace, CAP).await;
    for (user, key) in [
        ("alice", "cal/event/a"),
        ("bob", "cal/event/b"),
        ("bob", "x/other"),
    ] {
        let ok: HostReply<()> = call(&kernel, user, &id, &set(mine("room"), key, b"v")).await;
        assert_eq!(ok, HostReply::Ok(()), "{user} {key}");
    }
    let expected = vec![
        ("alice".to_string(), "cal/event/a".to_string()),
        ("bob".to_string(), "cal/event/b".to_string()),
    ];
    assert_eq!(listed(&kernel, "ed", &id).await, expected);
    let gone = delete(mine("room"), "cal/event/a");
    let ok: HostReply<()> = call(&kernel, "alice", &id, &gone).await;
    assert_eq!(ok, HostReply::Ok(()));
    assert_eq!(listed(&kernel, "ed", &id).await, expected[1..].to_vec());
    for key in ["cal/event/b", "x/other"] {
        let gone = delete(mine("room"), key);
        let ok: HostReply<()> = call(&kernel, "bob", &id, &gone).await;
        assert_eq!(ok, HostReply::Ok(()));
    }
    // Nothing is left behind once every author has left, not even the roster.
    assert_eq!(storage_keys(&kernel), Vec::<String>::new());
}

#[tokio::test]
async fn each_author_s_namespace_holds_at_most_its_quota_and_its_keys() {
    let kernel = workspace_serving(wasm(1, 4096)).await;
    let id = install(&kernel, "boss", InstallScope::Workspace, CAP).await;
    let big: HostReply<()> = call(
        &kernel,
        "alice",
        &id,
        &set(mine("room"), "a", &[0; 200_000]),
    )
    .await;
    assert_eq!(big, HostReply::Ok(()));
    let over: HostReply<()> =
        call(&kernel, "alice", &id, &set(mine("room"), "b", &[0; 70_000])).await;
    assert_eq!(over, HostReply::Refused(Refused::Limit("quota".into())));
    // Another author's namespace is their own: bob is not charged for alice's bytes.
    let bob: HostReply<()> = call(&kernel, "bob", &id, &set(mine("room"), "b", &[0; 60_000])).await;
    assert_eq!(bob, HostReply::Ok(()));
    for batch in 0..KV_MAX_KEYS / KV_MAX_SET_MANY {
        let entries = (0..KV_MAX_SET_MANY)
            .map(|i| KvEntry {
                key: format!("k{batch:02}{i:02}"),
                value: vec![1].into(),
            })
            .collect();
        let many = HostCall::Storage(StorageOps::KvSetMany(KvSetMany {
            backend: mine("office"),
            entries,
        }));
        let ok: HostReply<()> = call(&kernel, "ed", &id, &many).await;
        assert_eq!(ok, HostReply::Ok(()), "batch {batch}");
    }
    let one_more: HostReply<()> =
        call(&kernel, "ed", &id, &set(mine("office"), "last", b"v")).await;
    assert_eq!(one_more, HostReply::Refused(Refused::Limit("keys".into())));
}

#[tokio::test]
async fn the_scope_and_the_member_s_view_bound_where_one_may_post() {
    let kernel = workspace_serving(wasm(1, 4096)).await;
    let tree = install(
        &kernel,
        "boss",
        InstallScope::NodeTree("office".into()),
        CAP,
    )
    .await;
    let outside: HostReply<()> = call(
        &kernel,
        "alice",
        &tree,
        &set(mine(WORKSPACE_ROOT_ID), "k", b"v"),
    )
    .await;
    assert_eq!(outside, HostReply::Refused(Refused::Ungranted));
    let listing: HostReply<AuthoredPage> =
        call(&kernel, "alice", &tree, &across(WORKSPACE_ROOT_ID, None)).await;
    assert_eq!(listing, HostReply::Refused(Refused::Ungranted));
    // carol views `room` and nothing else.
    let wide = install(&kernel, "boss", InstallScope::Workspace, CAP).await;
    let unseen: HostReply<()> =
        call(&kernel, "carol", &wide, &set(mine("office"), "k", b"v")).await;
    assert_eq!(unseen, HostReply::Refused(Refused::Ungranted));
    let seen: HostReply<()> = call(&kernel, "carol", &wide, &set(mine("room"), "k", b"v")).await;
    assert_eq!(seen, HostReply::Ok(()));
}

#[tokio::test]
async fn a_write_is_announced_to_the_node_s_viewers_naming_install_store_and_keys() {
    let kernel = workspace_serving(wasm(1, 4096)).await;
    let id = install(&kernel, "boss", InstallScope::Workspace, CAP).await;
    let mut rx = kernel.subscribe_broadcast();
    let ok: HostReply<()> = call(
        &kernel,
        "alice",
        &id,
        &set(mine("room"), "cal/rsvp/1", b"yes"),
    )
    .await;
    assert_eq!(ok, HostReply::Ok(()));
    let message = rx.try_recv().expect("announced");
    assert_eq!(message.audience, BroadcastAudience::Node("room".into()));
    let expected = AppsResponse::StorageChanged {
        install_id: id,
        backend: StorageBackend::NodeAuthored {
            node_id: "room".into(),
            author: "alice".into(),
        },
        keys: vec!["cal/rsvp/1".into()],
    };
    let WorkspaceProtocolResponse::Apps(notice) = message.response else {
        panic!("not an apps notice");
    };
    assert_eq!(notice, expected);
}

#[tokio::test]
async fn a_self_scoped_install_s_writes_are_not_announced_to_the_node() {
    let kernel = workspace_serving(wasm(1, 4096)).await;
    let id = install(&kernel, "mgr", InstallScope::SelfOnly("mgr".into()), CAP).await;
    let mut rx = kernel.subscribe_broadcast();
    let ok: HostReply<()> = call(&kernel, "mgr", &id, &set(mine("room"), "k", b"v")).await;
    assert_eq!(ok, HostReply::Ok(()));
    assert!(rx.try_recv().is_err(), "nothing announced");
}

#[tokio::test]
async fn a_purge_removes_every_author_s_keys_and_the_roster() {
    let kernel = workspace_serving(wasm(1, 4096)).await;
    let id = install(&kernel, "boss", InstallScope::Workspace, CAP).await;
    for user in ["alice", "bob"] {
        let ok: HostReply<()> = call(&kernel, user, &id, &set(mine("room"), "cal/e", b"v")).await;
        assert_eq!(ok, HostReply::Ok(()));
    }
    assert!(!storage_keys(&kernel).is_empty());
    uninstall(&kernel, &id, true).await;
    assert_eq!(storage_keys(&kernel), Vec::<String>::new());
    let again = install(&kernel, "boss", InstallScope::Workspace, CAP).await;
    assert_eq!(listed(&kernel, "ed", &again).await, vec![]);
}
