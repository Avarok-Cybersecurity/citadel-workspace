//! Free slots on a booking page (Calendar design §3.6.1): the booker's client computes them from
//! the host's availability, published busy intervals and the type's rules; the host's instance
//! computes them again at claim and refuses a slot that is not among them.
//!
//! A slot starts every `increment_min` minutes from a window's start, in the availability's zone,
//! and fits the duration inside the window. It is offered only when it starts at least
//! `min_notice_min` from now, inside the type's date range, on a day below `max_per_day`, and
//! when the slot widened by its buffers overlaps nothing busy.

use crate::civil::{CivilDate, CivilDateTime, MINUTES_PER_DAY, MS_PER_DAY, MS_PER_MINUTE};
use crate::model_booking::{Availability, BookingRules, DateRange, Window};
use crate::tz::{instant_of, TimeZonePort, TzError};
use alloc::collections::BTreeMap;
use alloc::vec::Vec;

/// Days one query may cover.
pub const MAX_QUERY_DAYS: i64 = 366;
/// The finest increment a type may set.
pub const MIN_INCREMENT_MIN: u8 = 5;

/// `[start_ms, end_ms)`, UTC.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct Interval {
    pub start_ms: i64,
    pub end_ms: i64,
}

impl Interval {
    pub fn overlaps(&self, other: &Interval) -> bool {
        self.start_ms < other.end_ms && other.start_ms < self.end_ms
    }
}

pub struct SlotQuery<'a> {
    pub availability: &'a Availability,
    pub rules: &'a BookingRules,
    pub duration_min: u16,
    /// The host's busy intervals.
    pub busy: &'a [Interval],
    /// The host's confirmed bookings per date, in the availability's zone.
    pub booked: &'a BTreeMap<CivilDate, u8>,
    pub now_ms: i64,
    /// The dates asked about, inclusive, in the availability's zone.
    pub from: CivilDate,
    pub to: CivilDate,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SlotError {
    /// A zero duration, an increment under `MIN_INCREMENT_MIN`, or a window that is empty or
    /// leaves the day.
    BadRules,
    /// `to` before `from`, or more than `MAX_QUERY_DAYS` days.
    BadRange,
    Tz(TzError),
}

impl From<TzError> for SlotError {
    fn from(e: TzError) -> Self {
        SlotError::Tz(e)
    }
}

fn windows_on(availability: &Availability, date: CivilDate) -> &[Window] {
    match availability.overrides.iter().find(|o| o.date == date) {
        Some(o) => &o.windows,
        None => &availability.weekly[date.weekday().index()],
    }
}

fn check(q: &SlotQuery<'_>) -> Result<i64, SlotError> {
    let days = q.to.day_number() - q.from.day_number() + 1;
    if !(1..=MAX_QUERY_DAYS).contains(&days) {
        return Err(SlotError::BadRange);
    }
    let windows_ok = q
        .availability
        .weekly
        .iter()
        .chain(q.availability.overrides.iter().map(|o| &o.windows))
        .flatten()
        .all(|w| w.start_min < w.end_min && w.end_min <= MINUTES_PER_DAY);
    if q.duration_min == 0 || q.rules.increment_min < MIN_INCREMENT_MIN || !windows_ok {
        return Err(SlotError::BadRules);
    }
    Ok(days)
}

fn in_range(range: &DateRange, date: CivilDate, start_ms: i64, now_ms: i64) -> bool {
    match range {
        DateRange::Rolling { days } => start_ms <= now_ms + i64::from(*days) * MS_PER_DAY,
        DateRange::Fixed { from, to } => *from <= date && date <= *to,
        DateRange::Indefinite => true,
    }
}

/// Every free slot of `q`, in order, without duplicates.
pub fn free_slots(port: &dyn TimeZonePort, q: &SlotQuery<'_>) -> Result<Vec<Interval>, SlotError> {
    let days = check(q)?;
    let rules = q.rules;
    let duration = i64::from(q.duration_min) * MS_PER_MINUTE;
    let before = i64::from(rules.buffer_before_min) * MS_PER_MINUTE;
    let after = i64::from(rules.buffer_after_min) * MS_PER_MINUTE;
    let earliest = q.now_ms + i64::from(rules.min_notice_min) * MS_PER_MINUTE;
    let zone = &q.availability.zone;
    let mut slots = Vec::new();
    for offset in 0..days {
        let date = q.from.add_days(offset).ok_or(SlotError::BadRange)?;
        let full = rules
            .max_per_day
            .is_some_and(|max| q.booked.get(&date).copied().unwrap_or(0) >= max);
        if full {
            continue;
        }
        for window in windows_on(q.availability, date) {
            let mut minute = window.start_min;
            while minute + q.duration_min <= window.end_min {
                let local = CivilDateTime::new(date, minute).ok_or(SlotError::BadRules)?;
                let start_ms = instant_of(port, zone, local)?;
                let slot = Interval {
                    start_ms,
                    end_ms: start_ms + duration,
                };
                let padded = Interval {
                    start_ms: start_ms - before,
                    end_ms: slot.end_ms + after,
                };
                let free = !q.busy.iter().any(|b| b.overlaps(&padded));
                if start_ms >= earliest && in_range(&rules.range, date, start_ms, q.now_ms) && free
                {
                    slots.push(slot);
                }
                minute += u16::from(rules.increment_min);
            }
        }
    }
    slots.sort();
    slots.dedup();
    Ok(slots)
}

/// Whether `slot` is one `q` offers: what the host's instance asks at claim.
pub fn offers(
    port: &dyn TimeZonePort,
    q: &SlotQuery<'_>,
    slot: Interval,
) -> Result<bool, SlotError> {
    Ok(free_slots(port, q)?.binary_search(&slot).is_ok())
}
