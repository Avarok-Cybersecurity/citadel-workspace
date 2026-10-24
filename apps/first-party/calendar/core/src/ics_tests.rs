//! ICS out and in: what the Calendar exports reads back as the same times, text survives
//! escaping and folding, a busy-only event exports no content, a real client's file imports with
//! its zone and without its alarm's text, and what cannot be followed is skipped with a reason.

use crate::codec_tests::event;
use crate::ics_export::export;
use crate::ics_import::*;
use crate::ics_text::FOLD_AT;
use crate::model::{Freq, Location, RRule, Recurrence, Visibility, When};
use crate::test_tz::{at, date, utc, zone, Jiff};
use std::string::String;
use std::vec;

fn round_trip(e: &crate::model::Event) -> Draft {
    let (text, unwritten) = export([e]);
    assert!(unwritten.is_empty());
    let imported = import(&Jiff, &text, &zone("Europe/Berlin")).expect("imports");
    assert_eq!(imported.skipped, vec![]);
    imported.drafts.into_iter().next().expect("one draft")
}

#[test]
fn a_one_off_an_all_day_and_a_recurring_event_read_back_as_written() {
    let mut once = event("once");
    once.when = When::Once {
        start_ms: utc(2026, 10, 5, 13, 0) as u64,
        end_ms: utc(2026, 10, 5, 14, 0) as u64,
    };
    let d = round_trip(&once);
    assert_eq!(
        (d.uid.as_str(), d.title.as_str(), d.when),
        ("once", "Design review", once.when.clone())
    );
    let mut all_day = event("off");
    all_day.when = When::AllDay {
        date: date(2026, 12, 24),
        days: 2,
    };
    assert_eq!(round_trip(&all_day).when, all_day.when);
    let mut weekly = event("weekly");
    weekly.when = When::Recurring(Recurrence {
        start: at(2026, 3, 2, 9, 0),
        duration_min: 45,
        rule: RRule {
            freq: Freq::Weekly,
            interval: 2,
            by_day: vec![crate::civil::Weekday::Mon],
            by_month_day: vec![],
            count: Some(10),
        },
        exdates: vec![date(2026, 3, 16)],
        until_ms: Some(utc(2026, 6, 1, 0, 0) as u64),
    });
    let d = round_trip(&weekly);
    assert_eq!(
        (d.when, d.zone),
        (weekly.when.clone(), zone("America/New_York"))
    );
}

#[test]
fn text_survives_escaping_and_lines_fold_within_75_octets() {
    let mut e = event("text");
    e.title = String::from("Plan; budget, \\ and \"notes\"\nline two — 日本語の会議の議題はとても長いのでこの行は折り返されます");
    e.location = Location::Text {
        text: "Room 4, floor 2".into(),
    };
    let (text, _) = export([&e]);
    assert!(
        text.split("\r\n").all(|l| l.len() <= FOLD_AT),
        "every physical line within 75 octets"
    );
    assert!(
        text.contains("LOCATION:Room 4\\, floor 2"),
        "a comma in text is escaped"
    );
    let d = import(&Jiff, &text, &zone("UTC"))
        .expect("imports")
        .drafts
        .remove(0);
    assert_eq!(d.title, e.title);
    assert_eq!(d.location.as_deref(), Some("Room 4, floor 2"));
}

#[test]
fn a_busy_only_event_exports_as_busy_with_no_content() {
    let mut e = event("busy");
    e.visibility = Visibility::BusyOnly;
    e.location = Location::InPerson {
        address: "Secret office".into(),
    };
    let (text, _) = export([&e]);
    assert!(text.contains("SUMMARY:Busy"));
    assert!(
        !text.contains("Design review") && !text.contains("Agenda") && !text.contains("Secret")
    );
}

const GOOGLE: &str = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Google Inc//Google Calendar 70.9054//EN\r\n\
BEGIN:VEVENT\r\nDTSTART;TZID=America/Los_Angeles:20261005T090000\r\nDTEND;TZID=America/Los_Angeles:20261005T093000\r\n\
UID:abc@google.com\r\nSUMMARY:Standup\r\nBEGIN:VALARM\r\nACTION:DISPLAY\r\nDESCRIPTION:Alarm text\r\n\
TRIGGER:-PT10M\r\nEND:VALARM\r\nDESCRIPTION:Daily sync\r\nEND:VEVENT\r\n\
BEGIN:VEVENT\r\nDTSTART:20261006T100000\r\nDURATION:PT1H\r\nUID:floating\r\nSUMMARY:Floating\r\n\
BEGIN:VALARM\r\nDESCRIPTION:Reminder\r\nTRIGGER:-PT5M\r\nEND:VALARM\r\nEND:VEVENT\r\n\
BEGIN:VEVENT\r\nDTSTART:20261007T100000Z\r\nRRULE:FREQ=MONTHLY;BYSETPOS=1;BYDAY=MO\r\nUID:setpos\r\nEND:VEVENT\r\n\
BEGIN:VEVENT\r\nUID:nostart\r\nSUMMARY:No start\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";

#[test]
fn a_client_s_file_imports_with_its_zone_and_skips_what_cannot_be_followed() {
    let imported = import(&Jiff, GOOGLE, &zone("Europe/Berlin")).expect("imports");
    let standup = &imported.drafts[0];
    assert_eq!(
        standup.when,
        When::Once {
            start_ms: utc(2026, 10, 5, 16, 0) as u64,
            end_ms: utc(2026, 10, 5, 16, 30) as u64
        }
    );
    assert_eq!(standup.zone, zone("America/Los_Angeles"));
    assert_eq!(
        standup.body.as_deref(),
        Some("Daily sync"),
        "the alarm's text is not the event's"
    );
    let floating = &imported.drafts[1];
    assert_eq!(
        floating.when,
        When::Once {
            start_ms: utc(2026, 10, 6, 8, 0) as u64,
            end_ms: utc(2026, 10, 6, 9, 0) as u64
        }
    );
    assert_eq!(
        floating.zone,
        zone("Europe/Berlin"),
        "a floating time is read in the zone the caller named"
    );
    assert_eq!(
        floating.body, None,
        "an alarm's text is never the event's description"
    );
    let why: vec::Vec<(&str, &str)> = imported
        .skipped
        .iter()
        .map(|s| (s.uid.as_deref().unwrap_or(""), s.why))
        .collect();
    assert_eq!(
        why,
        [("setpos", "unsupported_rrule"), ("nostart", "no_start")]
    );
}

#[test]
fn what_is_not_a_calendar_or_is_too_large_is_refused() {
    assert_eq!(
        import(&Jiff, "hello", &zone("UTC")),
        Err(ImportError::NotACalendar)
    );
    let huge = String::from("BEGIN:VCALENDAR\r\n") + &"X".repeat(ICS_MAX_BYTES);
    assert_eq!(
        import(&Jiff, &huge, &zone("UTC")),
        Err(ImportError::TooLarge)
    );
}
