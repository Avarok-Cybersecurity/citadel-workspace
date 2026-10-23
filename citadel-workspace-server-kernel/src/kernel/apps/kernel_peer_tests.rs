//! Peer-to-peer and topic authority through the kernel: a member's own consent and block list,
//! `AuthorizePeer` answering one `NoHost` for every reason, and the topic group record that no
//! app write can reach.

use super::kernel_call_tests::set;
use super::test_ihttp::{now_ms, refusal, served_digest, ALICE, BOB};
use super::test_manifests::*;
use super::test_runtime::{ask_on, call};
use super::test_support::Kernel;
use crate::kernel::cid_attribution::CidAttribution;
use citadel_app_sdk_types::calls::KvBackend;
use citadel_app_sdk_types::{HostReply, Refused};
use citadel_workspace_types::apps::peer::{PeerConsent, PeerDirection};
use citadel_workspace_types::apps::{Capability, InstallScope};
use citadel_workspace_types::apps_install::AppsRefusal;
use citadel_workspace_types::apps_protocol::AppsRequest;
use citadel_workspace_types::apps_responses::AppsResponse;
use serde_json::json;

const PEER_CAPS: &[Capability] = &[
    Capability::StorageScope,
    Capability::IhttpServe,
    Capability::IhttpP2pServe,
    Capability::IhttpP2pCall,
    Capability::GroupTopicSubscribe,
    Capability::GroupTopicPublish,
];

fn peer_spec() -> Spec {
    let optional = |cap: &str| json!({ "cap": cap, "why": "Pools", "optional": true });
    let topics =
        |cap: &str| json!({ "cap": cap, "why": "Pools", "optional": true, "topics": ["pool"] });
    let mut spec = Spec::new("1.0.0");
    spec.capabilities = json!([
        { "cap": "canvas", "why": "Draws", "optional": false },
        optional("storage.scope"),
        { "cap": "ihttp.serve", "why": "Serves", "optional": true, "routes": ["GET /cards"] },
        { "cap": "ihttp.p2p.serve", "why": "Serves", "optional": true, "routes": ["GET /cards"] },
        { "cap": "ihttp.p2p.call", "why": "Calls", "optional": true, "targets": [] },
        topics("group.topic.subscribe"),
        topics("group.topic.publish"),
    ]);
    spec.limits["p2p"] = json!({ "max_fanout_concurrency": 4, "max_fanout_bytes": 65536, "max_fanout_ms": 5000, "max_response_bytes": 4096 });
    spec.limits["topics"] = json!({ "max_msg_bytes": 1024, "max_msgs_per_s": 2 });
    spec
}

/// The workspace install of the peer app, and bob's session attributed to `BOB`.
async fn pool() -> (Kernel, String, CidAttribution) {
    let kernel = workspace_serving(wasm(1, 4096)).await;
    let (key, bytes, spec) = (publisher(1), wasm(1, 4096), peer_spec());
    let mut caps = vec![Capability::Canvas];
    caps.extend_from_slice(PEER_CAPS);
    let listing = signed(&spec, &key, &bytes);
    let request = install_request(&spec, &key, listing, InstallScope::Workspace, &caps, false);
    let id = match ask_on(&kernel, "boss", None, request).await {
        AppsResponse::Installed { install } => install.id,
        other => panic!("not installed: {other:?}"),
    };
    let bob = kernel.connected_users.attribute(BOB, "bob".to_string());
    (kernel, id, bob)
}

async fn consent(kernel: &Kernel, who: &str, id: &str, all: bool) -> AppsResponse {
    let request = AppsRequest::SetPeerConsentForMe {
        install_id: id.into(),
        serve: all,
        call: all,
        topics: all,
    };
    ask_on(kernel, who, None, request).await
}

async fn block(kernel: &Kernel, who: &str, id: &str, whom: &str, blocked: bool) -> AppsResponse {
    let request = AppsRequest::SetPeerBlockedForMe {
        install_id: id.into(),
        username: whom.into(),
        blocked,
    };
    ask_on(kernel, who, None, request).await
}

/// alice, on `ALICE`, asks about the session `peer`.
async fn authorize(kernel: &Kernel, id: &str, peer: u64, direction: PeerDirection) -> AppsResponse {
    let request = AppsRequest::AuthorizePeer {
        install_id: id.into(),
        peer_cid: peer,
        direction,
    };
    ask_on(kernel, "alice", Some(ALICE), request).await
}

fn serve(digest: String) -> PeerDirection {
    PeerDirection::Serve {
        routes_digest: digest,
    }
}

fn authorized_as(answer: &AppsResponse) -> Option<&str> {
    match answer {
        AppsResponse::PeerAuthorized { peer, .. } => Some(peer.username.as_str()),
        _ => None,
    }
}

async fn topic_group(kernel: &Kernel, who: &str, id: &str, claim: Option<&str>) -> AppsResponse {
    let request = AppsRequest::TopicGroup {
        install_id: id.into(),
        topic: "pool".into(),
        claim: claim.map(str::to_string),
    };
    ask_on(kernel, who, None, request).await
}

fn group_key(answer: &AppsResponse) -> Option<Option<&str>> {
    match answer {
        AppsResponse::TopicGroup { group_key, .. } => Some(group_key.as_deref()),
        _ => None,
    }
}

#[tokio::test]
async fn consent_is_each_members_own_and_both_ends_need_it() {
    let (kernel, id, _bob) = pool().await;
    let before = now_ms();
    match ask_on(&kernel, "alice", None, AppsRequest::ListInstalls).await {
        AppsResponse::Installs { peer_for_me, .. } => assert!(peer_for_me.is_empty()),
        other => panic!("{other:?}"),
    }
    let none = authorize(&kernel, &id, BOB, PeerDirection::Call).await;
    assert_eq!(
        refusal(&none),
        Some(&AppsRefusal::NoHost),
        "nobody consented"
    );
    match consent(&kernel, "alice", &id, true).await {
        AppsResponse::PeerConsentForMe { consent, .. } => {
            assert!(consent.serve && consent.call && consent.topics && consent.at_ms >= before)
        }
        other => panic!("{other:?}"),
    }
    let one = authorize(&kernel, &id, BOB, PeerDirection::Call).await;
    assert_eq!(
        refusal(&one),
        Some(&AppsRefusal::NoHost),
        "bob did not consent"
    );
    consent(&kernel, "bob", &id, true).await;
    let both = authorize(&kernel, &id, BOB, PeerDirection::Call).await;
    assert_eq!(authorized_as(&both), Some("bob"));
    match ask_on(&kernel, "alice", None, AppsRequest::ListInstalls).await {
        AppsResponse::Installs { peer_for_me, .. } => {
            assert_eq!(peer_for_me.len(), 1);
            assert_ne!(peer_for_me[0].consent, PeerConsent::NONE);
        }
        other => panic!("{other:?}"),
    }
    consent(&kernel, "bob", &id, false).await;
    let withdrawn = authorize(&kernel, &id, BOB, PeerDirection::Call).await;
    assert_eq!(refusal(&withdrawn), Some(&AppsRefusal::NoHost));
}

#[tokio::test]
async fn every_refusal_is_the_same_no_host() {
    let (kernel, id, _bob) = pool().await;
    consent(&kernel, "alice", &id, true).await;
    consent(&kernel, "bob", &id, true).await;
    let ok = authorize(&kernel, &id, BOB, serve(served_digest())).await;
    assert_eq!(authorized_as(&ok), Some("bob"));
    let cases = [
        authorize(&kernel, &id, BOB, serve("other".into())).await,
        authorize(&kernel, &id, BOB + 1, PeerDirection::Call).await,
        authorize(&kernel, "no-such-install", BOB, PeerDirection::Call).await,
        authorize(&kernel, &id, ALICE, PeerDirection::Call).await,
        authorize(
            &kernel,
            &id,
            BOB,
            PeerDirection::Topic {
                topic: "other".into(),
            },
        )
        .await,
    ];
    for (i, answer) in cases.iter().enumerate() {
        assert_eq!(refusal(answer), Some(&AppsRefusal::NoHost), "case {i}");
    }
}

#[tokio::test]
async fn a_block_by_either_end_refuses_and_lifting_it_restores() {
    let (kernel, id, _bob) = pool().await;
    consent(&kernel, "alice", &id, true).await;
    consent(&kernel, "bob", &id, true).await;
    let own = block(&kernel, "alice", &id, "alice", true).await;
    assert_eq!(refusal(&own), Some(&AppsRefusal::Policy));
    assert!(matches!(
        block(&kernel, "bob", &id, "alice", true).await,
        AppsResponse::PeerBlockedForMe { blocked: true, .. }
    ));
    let blocked = authorize(&kernel, &id, BOB, PeerDirection::Call).await;
    assert_eq!(refusal(&blocked), Some(&AppsRefusal::NoHost));
    block(&kernel, "bob", &id, "alice", false).await;
    let lifted = authorize(&kernel, &id, BOB, PeerDirection::Call).await;
    assert_eq!(authorized_as(&lifted), Some("bob"));
}

#[tokio::test]
async fn the_first_claim_of_a_topic_group_wins_and_apps_cannot_write_it() {
    let (kernel, id, _bob) = pool().await;
    let unconsented = topic_group(&kernel, "alice", &id, None).await;
    assert_eq!(refusal(&unconsented), Some(&AppsRefusal::Unavailable));
    consent(&kernel, "alice", &id, true).await;
    consent(&kernel, "bob", &id, true).await;
    assert_eq!(
        group_key(&topic_group(&kernel, "alice", &id, None).await),
        Some(None)
    );
    let first = topic_group(&kernel, "alice", &id, Some("group-1")).await;
    assert_eq!(group_key(&first), Some(Some("group-1")));
    let second = topic_group(&kernel, "bob", &id, Some("group-2")).await;
    assert_eq!(
        group_key(&second),
        Some(Some("group-1")),
        "the first claim stands"
    );
    let empty = topic_group(&kernel, "bob", &id, Some("")).await;
    assert!(matches!(refusal(&empty), Some(AppsRefusal::Limit(_))));
    let forged: HostReply<()> = call(
        &kernel,
        "alice",
        &id,
        &set(KvBackend::Scope, "sys/topic/pool", b"mine"),
    )
    .await;
    assert_eq!(
        forged,
        HostReply::Refused(Refused::Policy("reserved_key".into()))
    );
    let read = topic_group(&kernel, "bob", &id, None).await;
    assert_eq!(
        group_key(&read),
        Some(Some("group-1")),
        "the forged write changed nothing"
    );
}
