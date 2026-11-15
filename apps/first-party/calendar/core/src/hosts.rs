//! Which host takes a team booking (Calendar design §3.6.2). Clients compute; the chosen host's
//! instance verifies at claim, and when that host is offline the booker tries the next in order.
//!
//! - Round robin answers the free hosts in the order to try: `Equal` fewest confirmed bookings in
//!   its period (`equal_period`) first, `Priority` highest weight first, `Availability` as listed; ties by name.
//! - Collective offers only the slots every host has free.

use crate::civil::{CivilDate, CivilDateTime};
use crate::model::Username;
use crate::model_booking::Strategy;
use crate::nav::add_months;
use crate::slots::Interval;
use crate::tz::{civil_of, instant_of, TimeZonePort, TzError, Zone};
use alloc::collections::BTreeMap;
use alloc::vec::Vec;

/// The zone `Equal`'s period is read in when the type locks none.
pub const EQUAL_PERIOD_ZONE: &str = "UTC";

/// The span `Equal` counts each host's confirmed bookings over: the calendar month holding
/// `at_ms`, in the type's locked zone, or in UTC when it locks none. It depends on the type and the
/// slot alone, never on who asks: two bookers in different zones, or a type inherited by nodes
/// with different zones, rank the same hosts the same way.
pub fn equal_period(
    port: &dyn TimeZonePort,
    zone_lock: Option<&Zone>,
    at_ms: i64,
) -> Result<Interval, TzError> {
    let utc = Zone::new(EQUAL_PERIOD_ZONE).ok_or(TzError::OutOfRange)?;
    let zone = zone_lock.unwrap_or(&utc);
    let day = civil_of(port, zone, at_ms)?.date();
    let first = CivilDate::new(day.year(), day.month(), 1).ok_or(TzError::OutOfRange)?;
    let next = add_months(first, 1).ok_or(TzError::OutOfRange)?;
    let start_of = |date: CivilDate| -> Result<i64, TzError> {
        instant_of(port, zone, CivilDateTime::new(date, 0).ok_or(TzError::OutOfRange)?)
    };
    Ok(Interval {
        start_ms: start_of(first)?,
        end_ms: start_of(next)?,
    })
}

/// The free hosts of `hosts`, in the order a booking tries them. `confirmed` counts each host's
/// confirmed bookings in the strategy's period (`equal_period` for `Equal`); a host it does not
/// name has none.
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
