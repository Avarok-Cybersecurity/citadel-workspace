//! RFC 5545's text layer, shared by `ics_export` and `ics_import`: escaping, line folding,
//! date and time values, and the RRULE value. Nothing here knows about events.

use crate::civil::{CivilDate, CivilDateTime, Weekday, MS_PER_MINUTE};
use crate::model::{Freq, RRule};
use alloc::format;
use alloc::string::{String, ToString};
use alloc::vec::Vec;

/// Octets per line before a fold (RFC 5545 §3.1).
pub const FOLD_AT: usize = 75;

pub fn escape(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        match c {
            '\\' => out.push_str("\\\\"),
            ';' => out.push_str("\\;"),
            ',' => out.push_str("\\,"),
            '\n' => out.push_str("\\n"),
            '\r' => {}
            c => out.push(c),
        }
    }
    out
}

pub fn unescape(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars();
    while let Some(c) = chars.next() {
        if c != '\\' {
            out.push(c);
            continue;
        }
        match chars.next() {
            Some('n') | Some('N') => out.push('\n'),
            Some(other) => out.push(other),
            None => {}
        }
    }
    out
}

/// One content line, folded at `FOLD_AT` octets without splitting a character, CRLF-ended.
pub fn fold(line: &str, out: &mut String) {
    let mut used = 0;
    for c in line.chars() {
        if used + c.len_utf8() > FOLD_AT {
            out.push_str("\r\n ");
            used = 1;
        }
        out.push(c);
        used += c.len_utf8();
    }
    out.push_str("\r\n");
}

/// The content lines of `text`, unfolded.
pub fn unfold(text: &str) -> Vec<String> {
    let mut lines: Vec<String> = Vec::new();
    for raw in text.split('\n') {
        let raw = raw.strip_suffix('\r').unwrap_or(raw);
        match (
            raw.strip_prefix(' ').or_else(|| raw.strip_prefix('\t')),
            lines.last_mut(),
        ) {
            (Some(rest), Some(last)) => last.push_str(rest),
            _ if raw.is_empty() => {}
            _ => lines.push(raw.to_string()),
        }
    }
    lines
}

pub fn date_value(d: CivilDate) -> String {
    format!("{:04}{:02}{:02}", d.year(), d.month(), d.day())
}

pub fn local_value(t: CivilDateTime) -> String {
    format!(
        "{}T{:02}{:02}00",
        date_value(t.date()),
        t.minute() / 60,
        t.minute() % 60
    )
}

/// An instant as a UTC DATE-TIME (`...Z`), to the second.
pub fn utc_value(ms: i64) -> Option<String> {
    let minute = CivilDateTime::from_local_ms(ms - ms.rem_euclid(MS_PER_MINUTE))?;
    let seconds = ms.rem_euclid(MS_PER_MINUTE) / 1000;
    let local = local_value(minute);
    Some(format!("{}{:02}Z", &local[..local.len() - 2], seconds))
}

pub fn parse_date(v: &str) -> Option<CivilDate> {
    if v.len() != 8 || !v.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    CivilDate::new(
        v[..4].parse().ok()?,
        v[4..6].parse().ok()?,
        v[6..8].parse().ok()?,
    )
}

/// A DATE-TIME's wall time and whether it was UTC (`Z`); seconds are dropped.
pub fn parse_date_time(v: &str) -> Option<(CivilDateTime, bool)> {
    let (body, utc) = match v.strip_suffix('Z') {
        Some(body) => (body, true),
        None => (v, false),
    };
    let (date, time) = body.split_once('T')?;
    if time.len() != 6 || !time.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let (h, m): (u16, u16) = (time[..2].parse().ok()?, time[2..4].parse().ok()?);
    (h < 24 && m < 60).then_some(())?;
    Some((CivilDateTime::new(parse_date(date)?, h * 60 + m)?, utc))
}

const DAYS: [&str; 7] = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];

pub fn rrule_value(rule: &RRule, until: Option<String>) -> String {
    let freq = match rule.freq {
        Freq::Daily => "DAILY",
        Freq::Weekly => "WEEKLY",
        Freq::Monthly => "MONTHLY",
        Freq::Yearly => "YEARLY",
    };
    let mut parts = Vec::from([
        format!("FREQ={freq}"),
        format!("INTERVAL={}", rule.interval),
    ]);
    if !rule.by_day.is_empty() {
        let days: Vec<&str> = rule.by_day.iter().map(|d| DAYS[d.index()]).collect();
        parts.push(format!("BYDAY={}", days.join(",")));
    }
    if !rule.by_month_day.is_empty() {
        let days: Vec<String> = rule.by_month_day.iter().map(|d| d.to_string()).collect();
        parts.push(format!("BYMONTHDAY={}", days.join(",")));
    }
    if let Some(count) = rule.count {
        parts.push(format!("COUNT={count}"));
    }
    if let Some(until) = until {
        parts.push(format!("UNTIL={until}"));
    }
    parts.join(";")
}

/// The rule and its UNTIL text, if the value is the subset the Calendar follows.
pub fn parse_rrule(v: &str) -> Option<(RRule, Option<String>)> {
    // INTERVAL is 1 unless the value says otherwise (RFC 5545 §3.3.10); FREQ is required.
    let mut rule = RRule {
        freq: Freq::Daily,
        interval: 1,
        by_day: Vec::new(),
        by_month_day: Vec::new(),
        count: None,
    };
    let (mut freq, mut until) = (None, None);
    for part in v.split(';').filter(|p| !p.is_empty()) {
        let (name, value) = part.split_once('=')?;
        match name {
            "FREQ" => {
                freq = Some(match value {
                    "DAILY" => Freq::Daily,
                    "WEEKLY" => Freq::Weekly,
                    "MONTHLY" => Freq::Monthly,
                    "YEARLY" => Freq::Yearly,
                    _ => return None,
                })
            }
            "INTERVAL" => rule.interval = value.parse().ok()?,
            "COUNT" => rule.count = Some(value.parse().ok()?),
            "UNTIL" => until = Some(value.to_string()),
            "BYDAY" => {
                for day in value.split(',') {
                    let index = DAYS.iter().position(|d| *d == day)?;
                    rule.by_day.push(Weekday::ALL[index]);
                }
            }
            "BYMONTHDAY" => {
                for day in value.split(',') {
                    rule.by_month_day.push(day.parse().ok()?);
                }
            }
            "WKST" if value == "MO" => {}
            _ => return None,
        }
    }
    rule.freq = freq?;
    Some((rule, until))
}
