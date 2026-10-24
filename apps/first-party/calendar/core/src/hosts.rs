//! Which host takes a team booking (Calendar design §3.6.2). Clients compute; the chosen host's
//! instance verifies at claim, and when that host is offline the booker tries the next in order.
//!
//! - Round robin answers the free hosts in the order to try: `Equal` fewest confirmed bookings in
//!   the period first, `Priority` highest weight first, `Availability` as listed; ties by name.
//! - Collective offers only the slots every host has free.

use crate::model::Username;
use crate::model_booking::Strategy;
use crate::slots::Interval;
use alloc::collections::BTreeMap;
use alloc::vec::Vec;

/// The free hosts of `hosts`, in the order a booking tries them. `confirmed` counts each host's
/// confirmed bookings in the strategy's period; a host it does not name has none.
pub fn rank_hosts(
    strategy: &Strategy,
    hosts: &[Username],
    is_free: &dyn Fn(&str) -> bool,
    confirmed: &BTreeMap<Username, u32>,
) -> Vec<Username> {
    let mut free: Vec<&Username> = Vec::new();
    for host in hosts.iter().filter(|h| is_free(h)) {
        if !free.contains(&host) {
            free.push(host);
        }
    }
    match strategy {
        Strategy::Equal => {
            free.sort_by_key(|h| (confirmed.get(*h).copied().unwrap_or(0), (*h).clone()));
        }
        Strategy::Priority { weights } => {
            let weight = |h: &Username| {
                weights
                    .iter()
                    .find(|(name, _)| name == h)
                    .map_or(0, |(_, w)| *w)
            };
            free.sort_by_key(|h| (core::cmp::Reverse(weight(h)), (*h).clone()));
        }
        Strategy::Availability => {}
    }
    free.into_iter().cloned().collect()
}

/// The slots every host offers. No hosts offer nothing: a collective with nobody in it is not
/// free at all hours.
pub fn collective_slots(per_host: &[Vec<Interval>]) -> Vec<Interval> {
    let Some((first, rest)) = per_host.split_first() else {
        return Vec::new();
    };
    first
        .iter()
        .filter(|slot| rest.iter().all(|other| other.binary_search(slot).is_ok()))
        .copied()
        .collect()
}
