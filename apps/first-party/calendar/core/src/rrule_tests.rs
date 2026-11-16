//! `rrule`: occurrences keep their wall time in the event's zone across DST, move for a viewer
//! whose zone disagrees, and follow COUNT, UNTIL, exdates, intervals and month ends as RFC 5545
//! does; a window outside the rule's reach or a malformed rule is said, never guessed at.

use crate::civil::Weekday;
use crate::model::{Freq, RRule, Recurrence};
use crate::rrule::*;
use crate::test_tz::{at, date, utc, zone, Jiff};
use crate::tz::civil_of;
use std::vec;
use std::vec::Vec;

fn rule(freq: Freq) -> RRule {
    RRule {
        freq,
        interval: 1,
        by_day: vec![],
        by_month_day: vec![],
        count: None,
    }
}

fn rec(start: crate::civil::CivilDateTime, rule: RRule) -> Recurrence {
    Recurrence {
        start,
        duration_min: 60,
        rule,
        exdates: vec![],
        until_ms: None,
    }
}

fn starts(r: &Recurrence, tz: &str, from: i64, to: i64) -> Vec<i64> {
    let e = expand(&Jiff, r, &zone(tz), from, to).expect("expanded");
    e.occurrences.iter().map(|o| o.start_ms).collect()
}

#[test]
fn a_weekly_meeting_keeps_its_wall_time_across_dst_and_moves_for_a_viewer_elsewhere() {
    let r = rec(at(2026, 3, 2, 9, 0), rule(Freq::Weekly));
    let got = starts(
        &r,
        "America/New_York",
        utc(2026, 3, 1, 0, 0),
        utc(2026, 4, 1, 0, 0),
    );
    let expected = [
        utc(2026, 3, 2, 14, 0),
        utc(2026, 3, 9, 13, 0),
        utc(2026, 3, 16, 13, 0),
        utc(2026, 3, 23, 13, 0),
        utc(2026, 3, 30, 13, 0),
    ];
    assert_eq!(got, expected);
    let ny = zone("America/New_York");
    let london = zone("Europe/London");
    for s in &got {
        assert_eq!(
            civil_of(&Jiff, &ny, *s).expect("ny").minute(),
            9 * 60,
            "09:00 in New York"
        );
    }
    let in_london: Vec<u16> = got
        .iter()
        .map(|s| civil_of(&Jiff, &london, *s).expect("ldn").minute() / 60)
        .collect();
    assert_eq!(
        in_london,
        [14, 13, 13, 13, 14],
        "London disagrees between the two DST changes"
    );
}

#[test]
fn a_daily_time_in_the_spring_gap_moves_forward_by_the_gap() {
    let r = rec(at(2026, 3, 7, 2, 30), rule(Freq::Daily));
    let got = starts(
        &r,
        "America/New_York",
        utc(2026, 3, 7, 0, 0),
        utc(2026, 3, 10, 0, 0),
    );
    assert_eq!(
        got,
        [
            utc(2026, 3, 7, 7, 30),
            utc(2026, 3, 8, 7, 30),
            utc(2026, 3, 9, 6, 30)
        ]
    );
}

#[test]
fn count_counts_exdated_candidates_and_until_stops_the_rule() {
    let mut r = rec(
        at(2026, 1, 5, 9, 0),
        RRule {
            count: Some(3),
            ..rule(Freq::Daily)
        },
    );
    r.exdates = vec![date(2026, 1, 6)];
    let got = starts(&r, "UTC", 0, utc(2027, 1, 1, 0, 0));
    assert_eq!(got, [utc(2026, 1, 5, 9, 0), utc(2026, 1, 7, 9, 0)]);
    let mut r = rec(at(2026, 1, 5, 9, 0), rule(Freq::Daily));
    r.until_ms = Some(utc(2026, 1, 7, 9, 0) as u64);
    assert_eq!(starts(&r, "UTC", 0, utc(2027, 1, 1, 0, 0)).len(), 3);
}

#[test]
fn month_ends_negative_days_and_short_months() {
    let last = rec(
        at(2026, 1, 31, 9, 0),
        RRule {
            by_month_day: vec![-1],
            ..rule(Freq::Monthly)
        },
    );
    let got = starts(&last, "UTC", 0, utc(2026, 4, 1, 0, 0));
    assert_eq!(
        got,
        [
            utc(2026, 1, 31, 9, 0),
            utc(2026, 2, 28, 9, 0),
            utc(2026, 3, 31, 9, 0)
        ]
    );
    let the_31st = rec(at(2026, 1, 31, 9, 0), rule(Freq::Monthly));
    let got = starts(&the_31st, "UTC", 0, utc(2026, 6, 1, 0, 0));
    assert_eq!(
        got,
        [
            utc(2026, 1, 31, 9, 0),
            utc(2026, 3, 31, 9, 0),
            utc(2026, 5, 31, 9, 0)
        ]
    );
}

#[test]
fn every_other_week_on_two_days_and_a_leap_day_yearly() {
    let r = rec(
        at(2026, 10, 5, 9, 0),
        RRule {
            interval: 2,
            by_day: vec![Weekday::Thu, Weekday::Mon],
            ..rule(Freq::Weekly)
        },
    );
    let got = starts(&r, "UTC", 0, utc(2026, 10, 31, 0, 0));
    assert_eq!(
        got,
        [
            utc(2026, 10, 5, 9, 0),
            utc(2026, 10, 8, 9, 0),
            utc(2026, 10, 19, 9, 0),
            utc(2026, 10, 22, 9, 0)
        ]
    );
    let leap = rec(at(2024, 2, 29, 9, 0), rule(Freq::Yearly));
    let got = starts(&leap, "UTC", 0, utc(2033, 1, 1, 0, 0));
    assert_eq!(
        got,
        [
            utc(2024, 2, 29, 9, 0),
            utc(2028, 2, 29, 9, 0),
            utc(2032, 2, 29, 9, 0)
        ]
    );
}

#[test]
fn only_occurrences_overlapping_the_window_are_answered() {
    let r = rec(at(2026, 1, 1, 9, 0), rule(Freq::Daily));
    let got = starts(&r, "UTC", utc(2026, 1, 3, 9, 30), utc(2026, 1, 5, 9, 0));
    assert_eq!(
        got,
        [utc(2026, 1, 3, 9, 0), utc(2026, 1, 4, 9, 0)],
        "the 3rd overlaps; the 5th starts at the end"
    );
}

#[test]
fn a_malformed_rule_a_far_window_and_a_full_window_are_said() {
    let bad = rec(
        at(2026, 1, 1, 9, 0),
        RRule {
            interval: 0,
            ..rule(Freq::Daily)
        },
    );
    assert_eq!(
        expand(&Jiff, &bad, &zone("UTC"), 0, i64::MAX),
        Err(ExpandError::BadRule)
    );
    let mixed = rec(
        at(2026, 1, 1, 9, 0),
        RRule {
            by_day: vec![Weekday::Mon],
            ..rule(Freq::Monthly)
        },
    );
    assert_eq!(
        expand(&Jiff, &mixed, &zone("UTC"), 0, i64::MAX),
        Err(ExpandError::BadRule)
    );
    let daily = rec(at(1990, 1, 1, 9, 0), rule(Freq::Daily));
    assert_eq!(
        expand(
            &Jiff,
            &daily,
            &zone("UTC"),
            utc(2200, 1, 1, 0, 0),
            utc(2200, 1, 2, 0, 0)
        ),
        Err(ExpandError::TooFar)
    );
    let full = expand(&Jiff, &daily, &zone("UTC"), 0, utc(2010, 1, 1, 0, 0)).expect("expanded");
    assert!(full.truncated);
    assert_eq!(full.occurrences.len(), MAX_OCCURRENCES);
}
