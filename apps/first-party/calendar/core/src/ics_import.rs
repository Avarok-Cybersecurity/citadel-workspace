//! ICS in (owner decision 7). A file's VEVENTs become drafts the member reviews before any is
//! saved; what the Calendar cannot follow is listed as skipped, with why, never half-read.
//!
//! A DATE-TIME with TZID is read in that zone; one ending in `Z` is UTC. A floating DATE-TIME
//! (neither) has no zone of its own, so the caller names the zone it is read in: the node's
//! effective zone, which the import dialog shows. There is no implicit zone.

use crate::civil::{CivilDateTime, MS_PER_DAY, MS_PER_MINUTE};
use crate::ics_props::{parse_duration, parse_line, place, Prop};
use crate::ics_text::*;
use crate::model::{Recurrence, When};
use crate::tz::{civil_of, instant_of, TimeZonePort, Zone};
use alloc::collections::BTreeMap;
use alloc::string::{String, ToString};
use alloc::vec::Vec;

pub const ICS_MAX_BYTES: usize = 1024 * 1024;
/// A node's authored events are capped at 2048 keys; a file of more cannot be saved anyway.
pub const ICS_MAX_EVENTS: usize = 2048;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Draft {
    pub uid: String,
    pub title: String,
    pub body: Option<String>,
    pub location: Option<String>,
    pub when: When,
    pub zone: Zone,
    pub cancelled: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Skipped {
    /// The VEVENT's place in the file, from 0.
    pub index: usize,
    pub uid: Option<String>,
    pub why: &'static str,
}

#[derive(Clone, Debug, PartialEq, Eq, Default)]
pub struct Imported {
    pub drafts: Vec<Draft>,
    pub skipped: Vec<Skipped>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ImportError {
    TooLarge,
    NotACalendar,
    TooManyEvents,
}

fn draft(
    port: &dyn TimeZonePort,
    props: &BTreeMap<String, Vec<Prop>>,
    floating: &Zone,
) -> Result<Draft, &'static str> {
    let one = |name: &str| props.get(name).and_then(|v| v.first());
    let text = |name: &str| one(name).map(|p| unescape(&p.value));
    let start = one("DTSTART").ok_or("no_start")?;
    let all_day = start.params.get("VALUE").is_some_and(|v| v == "DATE");
    let span = match (one("DTEND"), one("DURATION")) {
        (Some(end), _) => Some(Err(end)),
        (None, Some(d)) => Some(Ok(parse_duration(&d.value).ok_or("bad_duration")?)),
        (None, None) => None,
    };
    let (when, zone) = if all_day {
        if one("RRULE").is_some() {
            return Err("recurring_all_day");
        }
        let date = parse_date(&start.value).ok_or("bad_date")?;
        let days = match span {
            Some(Err(end)) => {
                parse_date(&end.value).ok_or("bad_date")?.day_number() - date.day_number()
            }
            Some(Ok(minutes)) => i64::from(minutes) / 1440,
            None => 1,
        };
        let days = u16::try_from(days)
            .ok()
            .filter(|d| *d >= 1)
            .ok_or("bad_span")?;
        (When::AllDay { date, days }, floating.clone())
    } else {
        let (wall, zone, at) = place(port, start, floating)?;
        let end_ms = match span {
            Some(Err(end)) => place(port, end, floating)?.2,
            Some(Ok(minutes)) => at + i64::from(minutes) * MS_PER_MINUTE,
            None => at,
        };
        if end_ms < at {
            return Err("ends_before_start");
        }
        match one("RRULE") {
            Some(r) => (
                When::Recurring(recurrence(port, props, r, wall, &zone, end_ms - at)?),
                zone,
            ),
            None => {
                let ms = |v: i64| u64::try_from(v).map_err(|_| "before_1970");
                (
                    When::Once {
                        start_ms: ms(at)?,
                        end_ms: ms(end_ms)?,
                    },
                    zone,
                )
            }
        }
    };
    Ok(Draft {
        uid: text("UID").ok_or("no_uid")?,
        title: text("SUMMARY").unwrap_or_default(),
        body: text("DESCRIPTION"),
        location: text("LOCATION"),
        when,
        zone,
        cancelled: one("STATUS").is_some_and(|s| s.value.eq_ignore_ascii_case("CANCELLED")),
    })
}

fn recurrence(
    port: &dyn TimeZonePort,
    props: &BTreeMap<String, Vec<Prop>>,
    r: &Prop,
    wall: CivilDateTime,
    zone: &Zone,
    span_ms: i64,
) -> Result<Recurrence, &'static str> {
    let (rule, until) = parse_rrule(&r.value).ok_or("unsupported_rrule")?;
    let until_ms = match until {
        None => None,
        Some(u) => Some(match parse_date(&u) {
            Some(d) => {
                instant_of(port, zone, CivilDateTime::new(d, 0).ok_or("bad_date")?)
                    .map_err(|_| "unknown_zone")?
                    + MS_PER_DAY
                    - 1
            }
            None => parse_date_time(&u)
                .filter(|(_, z)| *z)
                .ok_or("bad_until")?
                .0
                .local_ms(),
        }),
    };
    let mut exdates = Vec::new();
    for ex in props.get("EXDATE").into_iter().flatten() {
        for v in ex.value.split(',') {
            let prop = Prop {
                params: ex.params.clone(),
                value: v.to_string(),
            };
            let date = match parse_date(v) {
                Some(d) => d,
                None => civil_of(port, zone, place(port, &prop, zone)?.2)
                    .map_err(|_| "unknown_zone")?
                    .date(),
            };
            exdates.push(date);
        }
    }
    Ok(Recurrence {
        start: wall,
        duration_min: u32::try_from(span_ms / MS_PER_MINUTE).map_err(|_| "bad_span")?,
        rule,
        exdates,
        until_ms: until_ms
            .map(|u| u64::try_from(u).map_err(|_| "before_1970"))
            .transpose()?,
    })
}

/// The VEVENTs of `text`, as drafts; floating times are read in `floating`.
pub fn import(
    port: &dyn TimeZonePort,
    text: &str,
    floating: &Zone,
) -> Result<Imported, ImportError> {
    if text.len() > ICS_MAX_BYTES {
        return Err(ImportError::TooLarge);
    }
    let lines = unfold(text);
    if lines
        .first()
        .map(|l| l.eq_ignore_ascii_case("BEGIN:VCALENDAR"))
        != Some(true)
    {
        return Err(ImportError::NotACalendar);
    }
    let (mut out, mut current, mut index) =
        (Imported::default(), None::<BTreeMap<String, Vec<Prop>>>, 0);
    // Components inside a VEVENT (a VALARM) are skipped whole: their properties are not the event's.
    let mut nested = 0usize;
    for line in &lines {
        let upper = line.to_ascii_uppercase();
        match (upper.as_str(), current.as_mut()) {
            ("BEGIN:VEVENT", None) => current = Some(BTreeMap::new()),
            (begin, Some(_)) if begin.starts_with("BEGIN:") => nested += 1,
            (end, Some(_)) if end.starts_with("END:") && nested > 0 => nested -= 1,
            ("END:VEVENT", Some(_)) => {
                let props = current.take().unwrap_or_default();
                if out.drafts.len() + out.skipped.len() == ICS_MAX_EVENTS {
                    return Err(ImportError::TooManyEvents);
                }
                let uid = props
                    .get("UID")
                    .and_then(|v| v.first())
                    .map(|p| unescape(&p.value));
                match draft(port, &props, floating) {
                    Ok(d) => out.drafts.push(d),
                    Err(why) => out.skipped.push(Skipped { index, uid, why }),
                }
                index += 1;
            }
            (_, Some(props)) if nested == 0 => {
                if let Some((name, prop)) = parse_line(line) {
                    props.entry(name).or_default().push(prop);
                }
            }
            _ => {}
        }
    }
    Ok(out)
}
