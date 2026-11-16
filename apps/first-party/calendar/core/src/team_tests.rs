//! `team`: a group slot's seats run down with each booking and never below zero; a collective is
//! booked only when every host confirmed, and otherwise names who to cancel and the first
//! refusing host's alternatives.

use crate::slots::Interval;
use crate::team::*;
use std::string::String;
use std::vec;

fn at(h: i64) -> Interval {
    Interval {
        start_ms: h * 3_600_000,
        end_ms: h * 3_600_000 + 1_800_000,
    }
}

#[test]
fn a_group_slot_s_seats_decrement_with_each_booking_and_stop_at_zero() {
    assert_eq!(seats_left(3, 0), 3);
    assert_eq!(seats_left(3, 2), 1);
    assert_eq!(seats_left(3, 3), 0);
    assert_eq!(seats_left(3, 70_000), 0);
}

#[test]
fn a_collective_is_booked_only_when_every_host_confirmed() {
    let all = vec![
        ("ana".into(), HostAnswer::Confirmed),
        ("bo".into(), HostAnswer::Confirmed),
    ];
    assert_eq!(collective_outcome(&all), Ok(CollectiveOutcome::Booked));
}

#[test]
fn a_late_conflict_rolls_back_the_hosts_who_confirmed_and_shows_its_alternatives() {
    let answers = vec![
        (String::from("ana"), HostAnswer::Confirmed),
        ("bo".into(), HostAnswer::Confirmed),
        (
            "cy".into(),
            HostAnswer::Conflict {
                alternatives: vec![at(11)],
            },
        ),
        (
            "di".into(),
            HostAnswer::Conflict {
                alternatives: vec![at(15)],
            },
        ),
    ];
    assert_eq!(
        collective_outcome(&answers),
        Ok(CollectiveOutcome::RolledBack {
            cancel: vec!["ana".into(), "bo".into()],
            conflict: Some(("cy".into(), vec![at(11)]))
        })
    );
}

#[test]
fn an_unreachable_host_rolls_back_too_with_no_alternatives_to_show() {
    let answers = vec![
        (String::from("ana"), HostAnswer::Confirmed),
        ("bo".into(), HostAnswer::Unreachable),
    ];
    assert_eq!(
        collective_outcome(&answers),
        Ok(CollectiveOutcome::RolledBack {
            cancel: vec!["ana".into()],
            conflict: None
        })
    );
}

#[test]
fn a_collective_needs_one_to_eight_distinct_hosts() {
    assert_eq!(collective_outcome(&[]), Err(TeamError::BadHosts));
    let twice = vec![
        (String::from("ana"), HostAnswer::Confirmed),
        ("ana".into(), HostAnswer::Confirmed),
    ];
    assert_eq!(collective_outcome(&twice), Err(TeamError::BadHosts));
    let nine: std::vec::Vec<_> = (0..=MAX_COLLECTIVE_HOSTS)
        .map(|i| (format!("h{i}"), HostAnswer::Confirmed))
        .collect();
    assert_eq!(collective_outcome(&nine), Err(TeamError::BadHosts));
    assert_eq!(
        collective_outcome(&nine[..MAX_COLLECTIVE_HOSTS]),
        Ok(CollectiveOutcome::Booked)
    );
}
