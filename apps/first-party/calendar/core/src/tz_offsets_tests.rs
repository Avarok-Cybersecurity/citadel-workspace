//! `tz_offsets`: resolving a wall time from offsets alone, as the page's Intl adapter must, gives
//! jiff's own answer around every transition of every zone from 1970 to 2040, and at random wall
//! times in random zones, wherever jiff's answer agrees with jiff's own offsets.
//!
//! It does not always: jiff's `to_ambiguous_zoned` reads Nuuk's 2023-10-28 23:00 as a fold into
//! -01, while its offsets (and the database's transitions) hold -02 throughout. Where the oracle
//! contradicts the offsets, the offsets are what the page sees, so the resolution must be
//! consistent with them instead; those cases are counted and bounded.

use crate::civil::CivilDateTime;
use crate::test_tz::{utc, Jiff, JiffOffsets, JiffOracle};
use crate::tz::{Resolution, TimeZonePort, Zone};
use crate::tz_offsets::ByOffsets;
use jiff::tz::TimeZone;
use jiff::Timestamp;
use proptest::prelude::*;
use std::string::String;
use std::vec::Vec;

fn zones() -> Vec<String> {
    jiff::tz::db()
        .available()
        .map(|n| String::from(n.as_str()))
        .filter(|n| Zone::new(n).is_some())
        .collect()
}

/// Whether `r` reads `wall` as `zone`'s offsets say: every offset it names is in force at the
/// instant it gives, and a gap's offsets are not.
fn consistent(zone: &Zone, wall: CivilDateTime, r: Resolution) -> bool {
    let holds = |o: i32| Jiff.offset_at(zone, wall.local_ms() - i64::from(o) * 1000) == Ok(o);
    match r {
        Resolution::Unique { offset_s } => holds(offset_s),
        Resolution::Fold { first_s, second_s } => {
            holds(first_s) && holds(second_s) && first_s > second_s
        }
        Resolution::Gap { before_s, after_s } => {
            !holds(before_s) && !holds(after_s) && before_s < after_s
        }
    }
}

/// Agrees with the oracle, or the oracle contradicts the offsets and the answer does not: true
/// for the latter, so the caller counts them.
fn agree(zone: &Zone, wall: CivilDateTime) -> bool {
    let ours = ByOffsets(JiffOffsets)
        .resolve(zone, wall)
        .expect("resolved");
    let oracle = JiffOracle.resolve(zone, wall).expect("resolved");
    if consistent(zone, wall, oracle) {
        assert_eq!(ours, oracle, "{} {wall:?}", zone.name());
        return false;
    }
    assert!(
        consistent(zone, wall, ours),
        "{} {wall:?}: {ours:?}",
        zone.name()
    );
    true
}

#[test]
fn offsets_alone_resolve_every_wall_time_around_every_transition_as_the_database_does() {
    let (from, to) = (utc(1970, 1, 1, 0, 0), utc(2040, 1, 1, 0, 0));
    let (mut checked, mut oracle_wrong) = (0usize, 0usize);
    for name in zones() {
        let zone = Zone::new(&name).expect("filtered");
        let tz = TimeZone::get(&name).expect("listed");
        for t in tz.following(Timestamp::from_millisecond(from).expect("ts")) {
            let at = t.timestamp().as_millisecond();
            if at >= to {
                break;
            }
            let before = tz
                .to_offset(Timestamp::from_millisecond(at - 1).expect("ts"))
                .seconds();
            let wall_at = at + i64::from(before) * 1000;
            // Every 15 minutes from 3 hours before the transition's wall time to 3 hours after.
            for step in -12..=12i64 {
                let wall_ms = wall_at + step * 15 * 60_000;
                let Some(wall) = CivilDateTime::from_local_ms(wall_ms - wall_ms.rem_euclid(60_000))
                else {
                    continue;
                };
                oracle_wrong += usize::from(agree(&zone, wall));
            }
            checked += 1;
        }
    }
    assert!(
        checked > 5000,
        "only {checked} transitions: the database was not read"
    );
    // Measured: 8, all Nuuk's 2023 change of standard offset. More means the oracle or the
    // offsets changed, and someone should look.
    assert!(
        oracle_wrong <= 8,
        "{oracle_wrong} wall times where jiff contradicts its own offsets"
    );
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(2000))]
    #[test]
    fn offsets_alone_agree_at_random_wall_times(zone_index in 0usize..600, minutes in 0i64..(70 * 366 * 1440)) {
        let all = zones();
        let zone = Zone::new(&all[zone_index % all.len()]).expect("filtered");
        let wall = CivilDateTime::from_local_ms(minutes * 60_000).expect("in range");
        agree(&zone, wall);
    }
}
