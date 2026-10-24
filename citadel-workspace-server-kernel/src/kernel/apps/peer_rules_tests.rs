use super::peer_rules::*;
use citadel_workspace_types::apps::peer::{PeerConsent, PeerDirection};
use citadel_workspace_types::apps::Capability;
use std::collections::BTreeSet;
use Capability::*;

fn all() -> BTreeSet<Capability> {
    [
        IhttpServe,
        IhttpP2pServe,
        IhttpP2pCall,
        GroupTopicSubscribe,
        StorageUser,
    ]
    .into()
}

fn consent(serve: bool, call: bool, topics: bool) -> PeerConsent {
    PeerConsent {
        serve,
        call,
        topics,
        at_ms: 1,
    }
}

fn side(name: &str) -> Side {
    let everything = with_consent(all(), &consent(true, true, true), false);
    Side {
        username: name.into(),
        reached: true,
        effective: everything,
        blocked: BTreeSet::new(),
    }
}

fn question() -> PeerQuestion {
    PeerQuestion {
        active: true,
        asker: side("bob"),
        peer: side("alice"),
        p2p_routes_digest: "d".into(),
        topics: vec!["pool".into()],
    }
}

fn serve() -> PeerDirection {
    PeerDirection::Serve {
        routes_digest: "d".into(),
    }
}

fn topic() -> PeerDirection {
    PeerDirection::Topic {
        topic: "pool".into(),
    }
}

#[test]
fn consent_removes_only_the_gated_capabilities_it_does_not_allow() {
    let got = with_consent(all(), &consent(true, false, false), false);
    assert_eq!(got, [IhttpServe, IhttpP2pServe, StorageUser].into());
    let none = with_consent(all(), &PeerConsent::NONE, false);
    assert_eq!(
        none,
        [IhttpServe, StorageUser].into(),
        "never answered: nothing gated"
    );
    let disabled = with_consent(all(), &consent(true, true, true), true);
    assert_eq!(
        disabled,
        [IhttpServe, StorageUser].into(),
        "disabled for me: none of them"
    );
}

#[test]
fn a_consenting_pair_inside_the_audience_is_authorized_in_every_direction() {
    for direction in [serve(), PeerDirection::Call, topic()] {
        assert!(authorized(&question(), &direction), "{direction:?}");
    }
}

/// Each branch the design names, alone, refuses, and every refusal is the same `false`: the
/// handler turns it into the one `NoHost`.
#[test]
fn every_failing_branch_alone_refuses() {
    type Break = fn(&mut PeerQuestion);
    let branches: [(&str, Break, PeerDirection); 13] = [
        (
            "wrong audience: the peer",
            |q| q.peer.reached = false,
            serve(),
        ),
        (
            "wrong audience: the asker",
            |q| q.asker.reached = false,
            PeerDirection::Call,
        ),
        (
            "no consent: the caller did not allow call",
            |q| q.peer.effective = with_consent(all(), &consent(true, false, true), false),
            serve(),
        ),
        (
            "no consent: the server did not allow serve",
            |q| q.asker.effective = with_consent(all(), &consent(false, true, true), false),
            serve(),
        ),
        (
            "no consent: the callee did not allow serve",
            |q| q.peer.effective = with_consent(all(), &consent(false, true, true), false),
            PeerDirection::Call,
        ),
        (
            "no consent: topics",
            |q| q.peer.effective = with_consent(all(), &consent(true, true, false), false),
            topic(),
        ),
        (
            "blocked by the asker",
            |q| _ = q.asker.blocked.insert("alice".into()),
            serve(),
        ),
        (
            "blocked by the peer",
            |q| _ = q.peer.blocked.insert("bob".into()),
            PeerDirection::Call,
        ),
        (
            "blocked, on a topic",
            |q| _ = q.asker.blocked.insert("alice".into()),
            topic(),
        ),
        ("suspended", |q| q.active = false, serve()),
        (
            "digest mismatch",
            |q| q.p2p_routes_digest = "other".into(),
            serve(),
        ),
        (
            "a topic the manifest does not name",
            |q| q.topics.clear(),
            topic(),
        ),
        ("oneself", |q| q.peer.username = "bob".into(), serve()),
    ];
    for (name, break_it, direction) in branches {
        let mut q = question();
        break_it(&mut q);
        assert!(!authorized(&q, &direction), "{name}");
    }
}
