//! Recurrence expansion (design §3.4): a recurring event's occurrences in a window, each placed
//! in the event's own zone, so a weekly 09:00 stays 09:00 through every DST change and moves for
//! a viewer whose zone disagrees. Candidates run in date order from the start; RFC 5545's COUNT
//! counts every candidate, exdated or not.

use crate::civil::{days_in_month, CivilDate, CivilDateTime, Weekday, MS_PER_MINUTE};
use crate::model::{Freq, RRule, Recurrence};
use crate::tz::{instant_of, TimeZonePort, TzError, Zone};
use alloc::vec::Vec;

/// Candidates an expansion examines before it gives up (a daily rule over 136 years).
pub const MAX_CANDIDATES: u32 = 50_000;
/// Occurrences one expansion answers; a window that holds more is truncated, and says so.
pub const MAX_OCCURRENCES: usize = 2_000;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Occurrence {
    pub start_ms: i64,
    pub end_ms: i64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Expansion {
    pub occurrences: Vec<Occurrence>,
    /// The window held more than `MAX_OCCURRENCES`.
    pub truncated: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ExpandError {
    /// The rule cannot be followed (interval 0, a day of the month outside -31..=31, a by-day list
    /// on a rule that is not weekly).
    BadRule,
    /// The window lies further from the start than `MAX_CANDIDATES` candidates reach.
    TooFar,
    Tz(TzError),
}

impl From<TzError> for ExpandError {
    fn from(e: TzError) -> Self {
        ExpandError::Tz(e)
    }
}

fn check(rule: &RRule) -> Result<(), ExpandError> {
    let days_ok = rule
        .by_month_day
        .iter()
        .all(|d| *d != 0 && (-31..=31).contains(d));
    let shaped = match rule.freq {
        Freq::Weekly => rule.by_month_day.is_empty(),
        Freq::Monthly => rule.by_day.is_empty(),
        Freq::Daily | Freq::Yearly => rule.by_day.is_empty() && rule.by_month_day.is_empty(),
    };
    if rule.interval == 0 || !days_ok || !shaped {
        return Err(ExpandError::BadRule);
    }
    Ok(())
}

/// The dates of period `k` (the k-th period of `interval`), in order.
fn period_dates(rule: &RRule, start: CivilDate, k: i64) -> Vec<CivilDate> {
    let step = k * i64::from(rule.interval);
    match rule.freq {
        Freq::Daily => start.add_days(step).into_iter().collect(),
        Freq::Weekly => {
            let mut days: Vec<Weekday> = rule.by_day.clone();
            if days.is_empty() {
                days.push(start.weekday());
            }
            days.sort();
            days.dedup();
            let monday = start.week_start().and_then(|m| m.add_days(step * 7));
            days.iter()
                .filter_map(|d| monday?.add_days(d.index() as i64))
                .collect()
        }
        Freq::Monthly => {
            let Some((year, month)) = CivilDate::month_offset(start.year(), start.month(), step)
            else {
                return Vec::new();
            };
            let last = i16::from(days_in_month(year, month));
            let mut wanted: Vec<i16> = rule.by_month_day.iter().map(|d| i16::from(*d)).collect();
            if wanted.is_empty() {
                wanted.push(i16::from(start.day()));
            }
            let mut days: Vec<u8> = wanted
                .iter()
                .map(|d| if *d < 0 { last + 1 + d } else { *d })
                .filter(|d| (1..=last).contains(d))
                .filter_map(|d| u8::try_from(d).ok())
                .collect();
            days.sort();
            days.dedup();
            days.iter()
                .filter_map(|d| CivilDate::new(year, month, *d))
                .collect()
        }
        Freq::Yearly => i32::try_from(step)
            .ok()
            .and_then(|years| CivilDate::new(start.year() + years, start.month(), start.day()))
            .into_iter()
            .collect(),
    }
}

/// The occurrences of `rec` (wall times in `zone`) that overlap `[from_ms, to_ms)`.
pub fn expand(
    port: &dyn TimeZonePort,
    rec: &Recurrence,
    zone: &Zone,
    from_ms: i64,
    to_ms: i64,
) -> Result<Expansion, ExpandError> {
    check(&rec.rule)?;
    let duration = i64::from(rec.duration_min) * MS_PER_MINUTE;
    let until = rec.until_ms.map(|u| i64::try_from(u).unwrap_or(i64::MAX));
    let start = rec.start.date();
    let (mut seen, mut occurrences) = (0u32, Vec::new());
    let done = |occurrences: Vec<Occurrence>| {
        Ok(Expansion {
            occurrences,
            truncated: false,
        })
    };
    for k in 0..=i64::from(MAX_CANDIDATES) {
        let dates = period_dates(&rec.rule, start, k);
        if dates.is_empty() && rec.rule.freq != Freq::Monthly && rec.rule.freq != Freq::Yearly {
            return done(occurrences);
        }
        for date in dates.into_iter().filter(|d| *d >= start) {
            if rec.rule.count.is_some_and(|count| seen >= count) {
                return done(occurrences);
            }
            seen += 1;
            if seen > MAX_CANDIDATES {
                return Err(ExpandError::TooFar);
            }
            let local = CivilDateTime::new(date, rec.start.minute()).ok_or(TzError::OutOfRange)?;
            let at = instant_of(port, zone, local)?;
            if at >= to_ms || until.is_some_and(|u| at > u) {
                return done(occurrences);
            }
            if at + duration > from_ms && !rec.exdates.contains(&date) {
                if occurrences.len() == MAX_OCCURRENCES {
                    return Ok(Expansion {
                        occurrences,
                        truncated: true,
                    });
                }
                occurrences.push(Occurrence {
                    start_ms: at,
                    end_ms: at + duration,
                });
            }
        }
    }
    Err(ExpandError::TooFar)
}
