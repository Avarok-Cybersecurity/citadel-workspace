//! `tz`: a gap moves forward by the gap, a fold takes its first occurrence, every instant round-
//! trips through its wall time unless it is a fold's second occurrence, and the rules hold at
//! every transition of every zone in the IANA database from 2000 to 2040.

use crate::civil::CivilDateTime;
use crate::test_tz::{at, utc, zone, Jiff};
use crate::tz::*;
use jiff::tz::TimeZone;
use jiff::Timestamp;

#[test]
fn a_nonexistent_wall_time_moves_forward_by_the_gap() {
    // New York, 2026-03-08: 02:00 EST becomes 03:00 EDT; 02:30 does not exist.
    let ny = zone("America/New_York");
    let instant = instant_of(&Jiff, &ny, at(2026, 3, 8, 2, 30)).expect("placed");
    assert_eq!(instant, utc(2026, 3, 8, 7, 30));
    assert_eq!(civil_of(&Jiff, &ny, instant), Ok(at(2026, 3, 8, 3, 30)));
}

#[test]
fn an_ambiguous_wall_time_takes_its_first_occurrence() {
    // New York, 2026-11-01: 01:30 happens at 05:30Z (EDT) and again at 06:30Z (EST).
    let ny = zone("America/New_York");
    let instant = instant_of(&Jiff, &ny, at(2026, 11, 1, 1, 30)).expect("placed");
    assert_eq!(instant, utc(2026, 11, 1, 5, 30));
}

#[test]
fn an_unknown_zone_is_said_and_never_read_as_utc() {
    let nowhere = zone("Mars/Olympus_Mons");
    assert_eq!(
        instant_of(&Jiff, &nowhere, at(2026, 1, 1, 9, 0)),
        Err(TzError::UnknownZone("Mars/Olympus_Mons".into()))
    );
    assert_eq!(Zone::new(""), None);
    assert_eq!(Zone::new("America/../etc"), None);
    assert_eq!(Zone::new("/UTC"), None);
}

/// Every zone the database names, and every transition in each from 2000 to 2040: the minute
/// inside a gap reads with the offset before it, the minute inside a fold resolves to its first
/// occurrence, and the minutes either side of the transition round-trip.
#[test]
fn the_rules_hold_at_every_transition_of_every_zone() {
    let (from, to) = (utc(2000, 1, 1, 0, 0), utc(2040, 1, 1, 0, 0));
    let mut checked = 0usize;
    for name in jiff::tz::db().available() {
        let Some(z) = Zone::new(name.as_str()) else {
            continue;
        };
        let tz = TimeZone::get(name.as_str()).expect("listed");
        let start = Timestamp::from_millisecond(from).expect("ts");
        for t in tz
            .following(start)
            .take_while(|t| t.timestamp().as_millisecond() < to)
        {
            let at_ms = t.timestamp().as_millisecond();
            let before = tz
                .to_offset(Timestamp::from_millisecond(at_ms - 1).expect("ts"))
                .seconds();
            let after = t.offset().seconds();
            if before == after || at_ms % 60_000 != 0 {
                continue;
            }
            let jump = i64::from(after - before) * 1000;
            if jump > 60_000 {
                // A gap: the wall time a minute after the transition, by the old offset, was
                // skipped, and is read with the old offset: it lands a minute after it.
                let wall = CivilDateTime::from_local_ms(at_ms + i64::from(before) * 1000 + 60_000);
                let placed = instant_of(&Jiff, &z, wall.expect("wall")).expect("placed");
                assert_eq!(placed, at_ms + 60_000, "{name} gap at {at_ms}");
            } else if jump < -60_000 {
                // A fold: the wall time a minute before the transition happens again after it;
                // its first occurrence is the one before.
                let wall = CivilDateTime::from_local_ms(at_ms + i64::from(before) * 1000 - 60_000);
                let placed = instant_of(&Jiff, &z, wall.expect("wall")).expect("placed");
                assert_eq!(placed, at_ms - 60_000, "{name} fold at {at_ms}");
            }
            // Outside a fold's repeated hour, every instant round-trips through its wall time.
            for edge in [at_ms - 60_000, at_ms + 60_000 - jump.min(0)] {
                let shown = civil_of(&Jiff, &z, edge).expect("shown");
                assert_eq!(
                    instant_of(&Jiff, &z, shown),
                    Ok(edge),
                    "{name} round trip at {edge}"
                );
            }
            checked += 1;
        }
    }
    assert!(
        checked > 1000,
        "only {checked} transitions checked: the database was not read"
    );
}
