//! ICS content lines as properties (RFC 5545 §3.1-3.3), for `ics_import`: a line's name,
//! parameters and value, a DURATION in minutes, and where a DATE-TIME property is.

use crate::civil::CivilDateTime;
use crate::ics_text::parse_date_time;
use crate::tz::{instant_of, TimeZonePort, Zone};
use alloc::collections::BTreeMap;
use alloc::string::{String, ToString};

/// One property: its parameters (upper-cased names) and value.
pub struct Prop {
    pub params: BTreeMap<String, String>,
    pub value: String,
}

pub fn parse_line(line: &str) -> Option<(String, Prop)> {
    let mut quoted = false;
    let colon = line
        .char_indices()
        .find(|(_, c)| {
            quoted ^= *c == '"';
            *c == ':' && !quoted
        })?
        .0;
    let (head, value) = (&line[..colon], &line[colon + 1..]);
    let mut parts = head.split(';');
    let name = parts.next()?.to_ascii_uppercase();
    let params = parts
        .filter_map(|p| p.split_once('='))
        .map(|(k, v)| (k.to_ascii_uppercase(), v.trim_matches('"').to_string()))
        .collect();
    Some((
        name,
        Prop {
            params,
            value: value.to_string(),
        },
    ))
}

/// Minutes in an RFC 5545 DURATION (`P1W`, `P2D`, `PT1H30M`); seconds are dropped.
pub fn parse_duration(v: &str) -> Option<u32> {
    let body = v.strip_prefix('+').unwrap_or(v).strip_prefix('P')?;
    let (mut total, mut digits, mut in_time) = (0u32, String::new(), false);
    for c in body.chars() {
        match c {
            'T' => in_time = true,
            '0'..='9' => digits.push(c),
            unit => {
                let n: u32 = digits.parse().ok()?;
                digits.clear();
                total = total.checked_add(match (unit, in_time) {
                    ('W', false) => n.checked_mul(7 * 1440)?,
                    ('D', false) => n.checked_mul(1440)?,
                    ('H', true) => n.checked_mul(60)?,
                    ('M', true) => n,
                    ('S', true) => n / 60,
                    _ => return None,
                })?;
            }
        }
    }
    digits.is_empty().then_some(total)
}

/// Where a DATE-TIME is: its wall time and zone, and its instant.
pub fn place(
    port: &dyn TimeZonePort,
    p: &Prop,
    floating: &Zone,
) -> Result<(CivilDateTime, Zone, i64), &'static str> {
    let (wall, utc) = parse_date_time(&p.value).ok_or("bad_date_time")?;
    if utc {
        return Ok((wall, Zone::new("UTC").ok_or("bad_zone")?, wall.local_ms()));
    }
    let zone = match p.params.get("TZID") {
        Some(name) => Zone::new(name).ok_or("bad_zone")?,
        None => floating.clone(),
    };
    let at = instant_of(port, &zone, wall).map_err(|_| "unknown_zone")?;
    Ok((wall, zone, at))
}
