//! Advertisements by instance, and how relayed streams end: by withdrawal, with the install, or
//! with the session. Each refusal or survival beside its control.

use super::ihttp_adverts::{is_instance_name, MAX_INSTANCES_PER_SESSION};
use super::ihttp_relay::IhttpRelay;
use super::ihttp_relay_end::Ended;
use super::ihttp_relay_types::{Endpoint, Forward, RelayFault};
use citadel_ihttp_types::IhttpFrameKind;

const NOW: u64 = 1_000_000;

/// A frame's destination as every test here names it: wherever its stream goes.
fn any(_: &Endpoint) -> bool {
    true
}
const UNTIL: u64 = NOW + 60_000;

fn end(cid: u64, user: &str, install: &str) -> Endpoint {
    Endpoint {
        cid,
        username: user.to_string(),
        install_id: install.to_string(),
        app_id: "com.acme.kanban".to_string(),
    }
}

/// alice (cid 1, install `from`) calls bob's host (cid 2, install i1) on her stream `stream`.
fn call(relay: &mut IhttpRelay, from: &str, stream: u64) -> u64 {
    let (client, server) = (end(1, "alice", from), end(2, "bob", "i1"));
    relay.open(client, stream, server, None, NOW).expect("open")
}

fn credit() -> IhttpFrameKind {
    IhttpFrameKind::Credit { n: 1 }
}

#[test]
fn an_instance_name_is_short_and_plain() {
    assert!(is_instance_name("zone-1_a"));
    for bad in ["", "a b", "a/b", "é", &"x".repeat(65)] {
        assert!(!is_instance_name(bad), "{bad:?}");
    }
    let mut relay = IhttpRelay::default();
    assert_eq!(
        relay.advertise("i1", 2, "bob", "a b", UNTIL, NOW),
        Err(RelayFault::Instance)
    );
    assert_eq!(
        relay.advertise("i1", 2, "bob", &"x".repeat(64), UNTIL, NOW),
        Ok(())
    );
}

#[test]
fn one_instance_withdrawing_leaves_a_sibling_serving_and_its_streams_open() {
    let mut relay = IhttpRelay::default();
    relay
        .advertise("i1", 2, "bob", "tab-a", UNTIL, NOW)
        .unwrap();
    relay
        .advertise("i1", 2, "bob", "tab-b", UNTIL, NOW)
        .unwrap();
    let served = call(&mut relay, "c1", 1);
    assert_eq!(relay.withdraw("i1", 2, "tab-a", NOW), Ended::default());
    assert_eq!(relay.host("i1", None, NOW), Some((2, "bob".into())));
    assert!(relay
        .from_server(2, "i1", served, &credit(), any, NOW)
        .is_ok());
    // Control: the last instance takes the advertisement and the stream with it.
    let ended = relay.withdraw("i1", 2, "tab-b", NOW);
    assert_eq!(ended.closed, 1);
    assert_eq!(relay.host("i1", None, NOW), None);
    assert_eq!(
        relay.from_server(2, "i1", served, &credit(), any, NOW),
        Err(RelayFault::NoStream)
    );
}

#[test]
fn a_withdrawal_tells_each_caller_on_the_id_it_knows() {
    let mut relay = IhttpRelay::default();
    relay.advertise("i1", 2, "bob", "z", UNTIL, NOW).unwrap();
    call(&mut relay, "c1", 7);
    let ended = relay.withdraw("i1", 2, "z", NOW);
    assert_eq!(
        ended.tell,
        [Forward {
            from: end(2, "bob", "i1"),
            to: end(1, "alice", "c1"),
            stream: 7
        }]
    );
    assert_eq!(
        relay.from_client(1, "c1", 7, &credit(), any, NOW),
        Err(RelayFault::NoStream)
    );
}

#[test]
fn a_withdrawal_ends_only_what_the_session_serves_for_that_install() {
    let mut relay = IhttpRelay::default();
    relay.advertise("i1", 2, "bob", "z", UNTIL, NOW).unwrap();
    let other = relay
        .open(end(1, "alice", "c1"), 3, end(3, "carol", "i1"), None, NOW)
        .unwrap();
    call(&mut relay, "c1", 4);
    assert_eq!(relay.withdraw("i1", 2, "z", NOW).closed, 1);
    assert!(
        relay
            .from_server(3, "i1", other, &credit(), any, NOW)
            .is_ok(),
        "carol's host still serves her stream"
    );
}

#[test]
fn the_instances_one_session_may_advertise_are_bounded() {
    let mut relay = IhttpRelay::default();
    for n in 0..MAX_INSTANCES_PER_SESSION {
        relay
            .advertise("i1", 2, "bob", &format!("z{n}"), UNTIL, NOW)
            .unwrap();
    }
    assert_eq!(
        relay.advertise("i1", 2, "bob", "one-more", UNTIL, NOW),
        Err(RelayFault::Busy)
    );
    // Control: renewing one already counted is not another.
    assert_eq!(relay.advertise("i1", 2, "bob", "z0", UNTIL, NOW), Ok(()));
}

#[test]
fn an_uninstall_ends_every_stream_of_the_install_both_ways_and_its_adverts() {
    let mut relay = IhttpRelay::default();
    relay.advertise("i1", 2, "bob", "z", UNTIL, NOW).unwrap();
    let served = call(&mut relay, "c1", 1);
    // alice's own install i1 calling itself through bob: both ends are i1, nobody is told.
    relay
        .open(end(1, "alice", "i1"), 2, end(2, "bob", "i1"), None, NOW)
        .unwrap();
    let ended = relay.forget_install("i1", NOW);
    assert_eq!(ended.closed, 2);
    assert_eq!(ended.tell.len(), 1, "{:?}", ended.tell);
    assert_eq!(ended.tell[0].to, end(1, "alice", "c1"));
    assert_eq!(relay.host("i1", None, NOW), None);
    assert_eq!(
        relay.from_server(2, "i1", served, &credit(), any, NOW),
        Err(RelayFault::NoStream)
    );
}

#[test]
fn an_uninstalled_caller_is_cancelled_at_the_server() {
    let mut relay = IhttpRelay::default();
    let served = call(&mut relay, "c1", 1);
    let ended = relay.forget_install("c1", NOW);
    assert_eq!(
        ended.tell,
        [Forward {
            from: end(1, "alice", "c1"),
            to: end(2, "bob", "i1"),
            stream: served
        }]
    );
}

#[test]
fn expired_instances_lapse_and_take_the_advert_when_none_is_left() {
    let mut relay = IhttpRelay::default();
    relay
        .advertise("i1", 2, "bob", "short", NOW + 1_000, NOW)
        .unwrap();
    relay.advertise("i1", 2, "bob", "long", UNTIL, NOW).unwrap();
    relay.expire(NOW + 1_000);
    assert_eq!(relay.host("i1", None, NOW + 1_000), Some((2, "bob".into())));
    assert_eq!(relay.withdraw("i1", 2, "long", NOW).closed, 0);
    assert_eq!(relay.host("i1", None, NOW + 1_000), None);
}
