//! The internal-HTTP relay's state, without the kernel: advertisements, stream limits,
//! renumbering, flow control and sessions ending.

use super::ihttp_flow::FlowFault;
use super::ihttp_relay::*;
use citadel_ihttp_types::{
    CancelReason, IhttpFrameKind, INITIAL_CREDIT, MAX_STREAMS_PER_CALLER, MAX_STREAMS_PER_SERVER,
    STREAM_TIMEOUT_MS,
};

const NOW: u64 = 1_000_000;

fn end(cid: u64, user: &str, install: &str) -> Endpoint {
    Endpoint {
        cid,
        username: user.to_string(),
        install_id: install.to_string(),
        app_id: "com.acme.kanban".to_string(),
    }
}

fn body(n: usize) -> IhttpFrameKind {
    IhttpFrameKind::Body { bytes: vec![0; n] }
}

fn credit(n: u32) -> IhttpFrameKind {
    IhttpFrameKind::Credit { n }
}

fn response_head() -> IhttpFrameKind {
    IhttpFrameKind::ResponseHead {
        status: 200,
        headers: vec![],
        body_len: None,
    }
}

/// alice (cid 1) calls bob's host (cid 2) for install i1; answers the server-side id.
fn opened(relay: &mut IhttpRelay, stream: u64, body_len: Option<u64>) -> u64 {
    relay
        .open(
            end(1, "alice", "i1"),
            stream,
            end(2, "bob", "i1"),
            body_len,
            NOW,
        )
        .expect("open")
}

#[test]
fn an_advertisement_is_short_lived_and_names_its_member() {
    let mut relay = IhttpRelay::default();
    assert_eq!(
        relay.advertise("i1", 2, "bob", NOW, NOW),
        Err(RelayFault::AdvertWindow)
    );
    assert_eq!(
        relay.advertise("i1", 2, "bob", NOW + MAX_ADVERT_MS + 1, NOW),
        Err(RelayFault::AdvertWindow)
    );
    relay
        .advertise("i1", 2, "bob", NOW + 60_000, NOW)
        .expect("ok");
    assert_eq!(relay.host("i1", None, NOW), Some((2, "bob".into())));
    assert_eq!(relay.host("i1", Some("bob"), NOW), Some((2, "bob".into())));
    assert_eq!(relay.host("i1", Some("carol"), NOW), None);
    assert_eq!(relay.host("i2", None, NOW), None);
    assert_eq!(relay.host("i1", None, NOW + 60_000), None);
}

#[test]
fn the_server_sees_relay_ids_and_the_caller_its_own() {
    let mut relay = IhttpRelay::default();
    let id = opened(&mut relay, 7, None);
    assert_ne!(id & RELAY_STREAM_BIT, 0);
    let back = relay
        .from_server(2, "i1", id, &response_head(), NOW)
        .expect("head");
    assert_eq!(
        (back.to.cid, back.stream, back.from.username.as_str()),
        (1, 7, "bob")
    );
    let forth = relay
        .from_client(1, "i1", 7, &credit(1), NOW)
        .expect("credit");
    assert_eq!((forth.to.cid, forth.stream), (2, id));
    // Two callers choosing the same id get different ids at the server.
    let other = relay
        .open(end(3, "carol", "i1"), 7, end(2, "bob", "i1"), None, NOW)
        .expect("open");
    assert_ne!(other, id);
}

#[test]
fn a_caller_cannot_choose_a_relay_id_or_reuse_an_open_one() {
    let mut relay = IhttpRelay::default();
    let taken = relay.open(
        end(1, "alice", "i1"),
        RELAY_STREAM_BIT | 5,
        end(2, "bob", "i1"),
        None,
        NOW,
    );
    assert_eq!(taken, Err(RelayFault::RelayStreamId));
    opened(&mut relay, 5, None);
    let again = relay.open(end(1, "alice", "i1"), 5, end(2, "bob", "i1"), None, NOW);
    assert_eq!(again, Err(RelayFault::StreamInUse));
}

#[test]
fn only_the_stream_s_own_ends_may_speak_on_it() {
    let mut relay = IhttpRelay::default();
    let id = opened(&mut relay, 1, None);
    assert_eq!(
        relay.from_server(3, "i1", id, &response_head(), NOW),
        Err(RelayFault::NoStream)
    );
    assert_eq!(
        relay.from_server(2, "i9", id, &response_head(), NOW),
        Err(RelayFault::NoStream)
    );
    assert_eq!(
        relay.from_client(3, "i1", 1, &credit(1), NOW),
        Err(RelayFault::NoStream)
    );
}

#[test]
fn streams_are_limited_per_caller_and_per_server() {
    let mut relay = IhttpRelay::default();
    for s in 0..u64::from(MAX_STREAMS_PER_CALLER) {
        opened(&mut relay, s, None);
    }
    let busy = relay.open(end(1, "alice", "i1"), 99, end(2, "bob", "i1"), None, NOW);
    assert_eq!(busy, Err(RelayFault::Busy));
    let mut cid = 10;
    while relay
        .open(end(cid, "x", "i1"), 0, end(2, "bob", "i1"), None, NOW)
        .is_ok()
    {
        cid += 1;
    }
    let opened_total = u64::from(MAX_STREAMS_PER_CALLER) + (cid - 10);
    assert_eq!(opened_total, u64::from(MAX_STREAMS_PER_SERVER));
}

#[test]
fn bodies_need_credit_and_stay_within_their_declared_length() {
    let mut relay = IhttpRelay::default();
    opened(&mut relay, 1, Some(10));
    for _ in 0..INITIAL_CREDIT - 1 {
        relay
            .from_client(1, "i1", 1, &body(1), NOW)
            .expect("credit");
    }
    let past = relay.from_client(1, "i1", 1, &body(8), NOW);
    assert_eq!(past, Err(RelayFault::Flow(FlowFault::TooLarge)));
    relay
        .from_client(1, "i1", 1, &body(1), NOW)
        .expect("last credit");
    let dry = relay.from_client(1, "i1", 1, &body(1), NOW);
    assert_eq!(dry, Err(RelayFault::Flow(FlowFault::NoCredit)));
}

#[test]
fn the_response_body_waits_for_its_head_and_the_stream_ends_with_both_ends() {
    let mut relay = IhttpRelay::default();
    let id = opened(&mut relay, 1, None);
    let early = relay.from_server(2, "i1", id, &body(1), NOW);
    assert_eq!(early, Err(RelayFault::Flow(FlowFault::OutOfOrder)));
    relay
        .from_client(1, "i1", 1, &IhttpFrameKind::End, NOW)
        .expect("end");
    let after = relay.from_client(1, "i1", 1, &body(1), NOW);
    assert_eq!(after, Err(RelayFault::Flow(FlowFault::AfterEnd)));
    relay
        .from_server(2, "i1", id, &response_head(), NOW)
        .expect("head");
    relay.from_server(2, "i1", id, &body(3), NOW).expect("body");
    relay
        .from_server(2, "i1", id, &IhttpFrameKind::End, NOW)
        .expect("end");
    assert_eq!(
        relay.from_server(2, "i1", id, &credit(1), NOW),
        Err(RelayFault::NoStream)
    );
}

#[test]
fn a_cancel_or_the_timeout_closes_the_stream() {
    let mut relay = IhttpRelay::default();
    let id = opened(&mut relay, 1, None);
    let cancel = IhttpFrameKind::Cancel {
        reason: CancelReason::Caller,
    };
    relay
        .from_client(1, "i1", 1, &cancel, NOW)
        .expect("cancel passes");
    assert_eq!(
        relay.from_server(2, "i1", id, &response_head(), NOW),
        Err(RelayFault::NoStream)
    );
    opened(&mut relay, 2, None);
    let late = relay.from_client(1, "i1", 2, &credit(1), NOW + STREAM_TIMEOUT_MS);
    assert_eq!(late, Err(RelayFault::NoStream));
}

#[test]
fn a_session_that_ends_takes_its_adverts_and_streams() {
    let mut relay = IhttpRelay::default();
    relay
        .advertise("i1", 2, "bob", NOW + 60_000, NOW)
        .expect("ok");
    opened(&mut relay, 1, None);
    opened(&mut relay, 2, None);
    assert_eq!(relay.forget_session(2), 2);
    assert_eq!(relay.host("i1", None, NOW), None);
    assert_eq!(
        relay.from_client(1, "i1", 1, &credit(1), NOW),
        Err(RelayFault::NoStream)
    );
    assert_eq!(relay.forget_session(2), 0);
}
