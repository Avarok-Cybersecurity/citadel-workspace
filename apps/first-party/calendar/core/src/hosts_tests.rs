//! `hosts`: each round-robin strategy orders the free hosts as it says, offline or busy hosts
//! are never chosen, and a collective offers only what every host has free.

use crate::hosts::*;
use crate::model::Username;
use crate::model_booking::Strategy;
use crate::slots::Interval;
use std::collections::BTreeMap;
use std::string::String;
use std::vec;
use std::vec::Vec;

fn names(list: &[&str]) -> Vec<Username> {
    list.iter().map(|s| String::from(*s)).collect()
}

fn all_free(_: &str) -> bool {
    true
}

#[test]
fn equal_takes_the_fewest_bookings_first_and_breaks_ties_by_name() {
    let hosts = names(&["cy", "ana", "bo"]);
    let counts = BTreeMap::from([("ana".into(), 3), ("bo".into(), 1)]);
    assert_eq!(
        rank_hosts(&Strategy::Equal, &hosts, &all_free, &counts),
        names(&["cy", "bo", "ana"])
    );
    let tied = BTreeMap::from([("ana".into(), 1), ("bo".into(), 1), ("cy".into(), 1)]);
    assert_eq!(
        rank_hosts(&Strategy::Equal, &hosts, &all_free, &tied),
        names(&["ana", "bo", "cy"])
    );
}

#[test]
fn priority_takes_the_heaviest_first_and_availability_keeps_the_listed_order() {
    let hosts = names(&["ana", "bo", "cy"]);
    let weights = Strategy::Priority {
        weights: vec![("cy".into(), 5), ("bo".into(), 5), ("ana".into(), 1)],
    };
    assert_eq!(
        rank_hosts(&weights, &hosts, &all_free, &BTreeMap::new()),
        names(&["bo", "cy", "ana"])
    );
    let listed = rank_hosts(
        &Strategy::Availability,
        &names(&["cy", "ana", "cy"]),
        &all_free,
        &BTreeMap::new(),
    );
    assert_eq!(listed, names(&["cy", "ana"]));
}

#[test]
fn a_host_who_is_not_free_is_never_ranked() {
    let hosts = names(&["ana", "bo"]);
    let only_bo = |h: &str| h == "bo";
    for strategy in [
        Strategy::Equal,
        Strategy::Availability,
        Strategy::Priority {
            weights: vec![("ana".into(), 9)],
        },
    ] {
        assert_eq!(
            rank_hosts(&strategy, &hosts, &only_bo, &BTreeMap::new()),
            names(&["bo"])
        );
    }
}

#[test]
fn a_collective_offers_only_what_every_host_has_free() {
    let s = |a: i64| Interval {
        start_ms: a,
        end_ms: a + 10,
    };
    let ana = vec![s(0), s(10), s(20)];
    let bo = vec![s(10), s(20), s(30)];
    let cy = vec![s(20), s(10)];
    let mut cy_sorted = cy.clone();
    cy_sorted.sort();
    assert_eq!(
        collective_slots(&[ana.clone(), bo.clone(), cy_sorted]),
        vec![s(10), s(20)]
    );
    assert_eq!(collective_slots(&[ana, vec![]]), Vec::<Interval>::new());
    // A slot free for some hosts but not all is not offered.
    let split = [vec![s(0), s(10)], vec![s(0)], vec![s(10)]];
    assert_eq!(collective_slots(&split), Vec::<Interval>::new());
    assert_eq!(
        collective_slots(&[]),
        Vec::<Interval>::new(),
        "no hosts offer nothing"
    );
}
