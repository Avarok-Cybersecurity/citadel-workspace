//! Team bookings past the choice of host (Calendar design §3.6.2, §3.6.3): how many seats a group
//! slot has left, and what a collective booking does once each host has answered its claim.
//!
//! A collective is all or nothing. Each host's confirm is written only after every host answered
//! 2xx; a host that confirmed before a later refusal is sent a cancel with reason
//! `COLLECTIVE_INCOMPLETE`, and the booker is shown the first refusing host's alternatives.

use crate::model::Username;
use crate::slots::Interval;
use alloc::vec::Vec;
use serde::{Deserialize, Serialize};

/// The reason a rolled-back collective's cancel carries.
pub const COLLECTIVE_INCOMPLETE: &str = "collective_incomplete";

/// The most hosts a collective claim fans out to (`FanoutLimits`, as the compute pool uses).
pub const MAX_COLLECTIVE_HOSTS: usize = 8;

/// Seats a group slot still has: `seats` less the confirmed bookings already in it.
pub fn seats_left(seats: u16, taken: usize) -> u16 {
    seats.saturating_sub(u16::try_from(taken).unwrap_or(u16::MAX))
}

/// What one host answered a collective claim.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
#[serde(rename_all = "snake_case")]
pub enum HostAnswer {
    Confirmed,
    /// 409: the slot is gone; these are the host's free slots near it.
    Conflict {
        alternatives: Vec<Interval>,
    },
    /// No instance of the host answered (offline, refused, timed out).
    Unreachable,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
#[serde(rename_all = "snake_case")]
pub enum CollectiveOutcome {
    /// Every host confirmed: each writes their event, and the booker theirs.
    Booked,
    /// Someone did not: `cancel` are the hosts that confirmed and must be told to drop it;
    /// `conflict` the first host that refused, with their alternatives, when one did.
    RolledBack {
        cancel: Vec<Username>,
        conflict: Option<(Username, Vec<Interval>)>,
    },
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TeamError {
    /// No hosts, more than `MAX_COLLECTIVE_HOSTS`, a host twice, or answers not one per host.
    BadHosts,
}

/// The outcome of a collective claim from each host's answer, in the order the hosts were asked.
pub fn collective_outcome(
    answers: &[(Username, HostAnswer)],
) -> Result<CollectiveOutcome, TeamError> {
    let names: Vec<&Username> = answers.iter().map(|(h, _)| h).collect();
    let distinct = names
        .iter()
        .enumerate()
        .all(|(i, h)| !names[..i].contains(h));
    if answers.is_empty() || answers.len() > MAX_COLLECTIVE_HOSTS || !distinct {
        return Err(TeamError::BadHosts);
    }
    if answers.iter().all(|(_, a)| *a == HostAnswer::Confirmed) {
        return Ok(CollectiveOutcome::Booked);
    }
    let cancel = answers
        .iter()
        .filter(|(_, a)| *a == HostAnswer::Confirmed)
        .map(|(h, _)| h.clone())
        .collect();
    let conflict = answers.iter().find_map(|(h, a)| match a {
        HostAnswer::Conflict { alternatives } => Some((h.clone(), alternatives.clone())),
        _ => None,
    });
    Ok(CollectiveOutcome::RolledBack { cancel, conflict })
}
