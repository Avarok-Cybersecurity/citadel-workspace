//! ICS out (owner decision 7: no external sync; ICS in and out instead). A member exports what
//! they can read; a `BusyOnly` event exports as "Busy" with no description or location, and a
//! private event is exported only by its author, who is the only one holding it.
//!
//! Recurring events keep their zone as a TZID naming the IANA zone, which is what every
//! mainstream client resolves; one-off events are written in UTC.

use crate::civil::CivilDateTime;
use crate::ics_text::*;
use crate::model::{Event, EventStatus, Location, Visibility, When};
use alloc::format;
use alloc::string::String;

fn instant(ms: u64) -> Option<String> {
    utc_value(i64::try_from(ms).ok()?)
}

fn when_lines(event: &Event, out: &mut String) -> Option<()> {
    let tzid = event.zone.name();
    match &event.when {
        When::Once { start_ms, end_ms } => {
            fold(&format!("DTSTART:{}", instant(*start_ms)?), out);
            fold(&format!("DTEND:{}", instant(*end_ms)?), out);
        }
        When::AllDay { date, days } => {
            fold(&format!("DTSTART;VALUE=DATE:{}", date_value(*date)), out);
            let end = date.add_days(i64::from(*days))?;
            fold(&format!("DTEND;VALUE=DATE:{}", date_value(end)), out);
        }
        When::Recurring(rec) => {
            fold(
                &format!("DTSTART;TZID={tzid}:{}", local_value(rec.start)),
                out,
            );
            fold(&format!("DURATION:PT{}M", rec.duration_min), out);
            let until = match rec.until_ms {
                Some(ms) => Some(instant(ms)?),
                None => None,
            };
            fold(&format!("RRULE:{}", rrule_value(&rec.rule, until)), out);
            for date in &rec.exdates {
                let at = CivilDateTime::new(*date, rec.start.minute())?;
                fold(&format!("EXDATE;TZID={tzid}:{}", local_value(at)), out);
            }
        }
    }
    Some(())
}

fn event_lines(event: &Event, out: &mut String) -> Option<()> {
    let busy = event.visibility == Visibility::BusyOnly;
    fold("BEGIN:VEVENT", out);
    fold(&format!("UID:{}", escape(&event.id)), out);
    fold(&format!("DTSTAMP:{}", instant(event.updated_ms)?), out);
    when_lines(event, out)?;
    let title = if busy { "Busy" } else { event.title.as_str() };
    fold(&format!("SUMMARY:{}", escape(title)), out);
    if let (false, Some(body)) = (busy, &event.body) {
        fold(&format!("DESCRIPTION:{}", escape(body)), out);
    }
    let place = match &event.location {
        Location::InPerson { address } => Some(address.as_str()),
        Location::Text { text } => Some(text.as_str()),
        Location::InApp => None,
    };
    if let (false, Some(place)) = (busy, place) {
        fold(&format!("LOCATION:{}", escape(place)), out);
    }
    let status = match event.status {
        EventStatus::Confirmed => "CONFIRMED",
        EventStatus::Cancelled { .. } => "CANCELLED",
    };
    fold(&format!("STATUS:{status}"), out);
    fold("END:VEVENT", out);
    Some(())
}

/// A VCALENDAR of `events`, and the ids of any that could not be written (an instant outside
/// the years ICS dates cover).
pub fn export<'a>(
    events: impl IntoIterator<Item = &'a Event>,
) -> (String, alloc::vec::Vec<String>) {
    let mut out = String::new();
    let mut unwritten = alloc::vec::Vec::new();
    for line in [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Avarok//Citadel Calendar//EN",
        "CALSCALE:GREGORIAN",
    ] {
        fold(line, &mut out);
    }
    for event in events {
        let mut one = String::new();
        match event_lines(event, &mut one) {
            Some(()) => out.push_str(&one),
            None => unwritten.push(event.id.clone()),
        }
    }
    fold("END:VCALENDAR", &mut out);
    (out, unwritten)
}
