//! The native `TimeZonePort` the tests use: jiff's bundled IANA database answering the offset
//! question, as Intl does in the page, with wall times resolved by `tz_offsets`, as in the page.
//! jiff's own wall-time resolution is kept apart as an oracle (`JiffOracle`).

use crate::civil::CivilDateTime;
use crate::tz::{Resolution, TimeZonePort, TzError, Zone};
use crate::tz_offsets::{ByOffsets, OffsetSource};
use jiff::tz::{AmbiguousOffset, TimeZone};
use jiff::Timestamp;
use std::string::ToString;

fn zone_of(zone: &Zone) -> Result<TimeZone, TzError> {
    TimeZone::get(zone.name()).map_err(|_| TzError::UnknownZone(zone.name().to_string()))
}

/// The offsets jiff's database gives: the one question the page's Intl adapter answers too.
pub struct JiffOffsets;

impl OffsetSource for JiffOffsets {
    fn offset_at(&self, zone: &Zone, utc_ms: i64) -> Result<i32, TzError> {
        let at = Timestamp::from_millisecond(utc_ms).map_err(|_| TzError::OutOfRange)?;
        Ok(zone_of(zone)?.to_offset(at).seconds())
    }
}

/// The port the tests use: wall times resolved from offsets by `tz_offsets`, as in the page.
pub struct Jiff;

impl TimeZonePort for Jiff {
    fn offset_at(&self, zone: &Zone, utc_ms: i64) -> Result<i32, TzError> {
        JiffOffsets.offset_at(zone, utc_ms)
    }

    fn resolve(&self, zone: &Zone, local: CivilDateTime) -> Result<Resolution, TzError> {
        ByOffsets(JiffOffsets).resolve(zone, local)
    }
}

/// jiff's own resolution of a wall time, an oracle independent of `tz_offsets`.
pub struct JiffOracle;

impl JiffOracle {
    pub fn resolve(&self, zone: &Zone, local: CivilDateTime) -> Result<Resolution, TzError> {
        let d = local.date();
        let (h, m) = ((local.minute() / 60) as i8, (local.minute() % 60) as i8);
        let date = jiff::civil::Date::new(d.year() as i16, d.month() as i8, d.day() as i8)
            .map_err(|_| TzError::OutOfRange)?;
        let at = date.at(h, m, 0, 0);
        Ok(match zone_of(zone)?.to_ambiguous_zoned(at).offset() {
            AmbiguousOffset::Unambiguous { offset } => Resolution::Unique {
                offset_s: offset.seconds(),
            },
            AmbiguousOffset::Gap { before, after } => Resolution::Gap {
                before_s: before.seconds(),
                after_s: after.seconds(),
            },
            AmbiguousOffset::Fold { before, after } => Resolution::Fold {
                first_s: before.seconds(),
                second_s: after.seconds(),
            },
        })
    }
}

pub fn zone(name: &str) -> Zone {
    Zone::new(name).expect("a zone name")
}

pub fn date(y: i32, m: u8, d: u8) -> crate::civil::CivilDate {
    crate::civil::CivilDate::new(y, m, d).expect("a date")
}

pub fn at(y: i32, m: u8, d: u8, h: u16, min: u16) -> CivilDateTime {
    CivilDateTime::new(date(y, m, d), h * 60 + min).expect("a time")
}

/// The instant of a UTC wall time, for expectations.
pub fn utc(y: i32, m: u8, d: u8, h: u16, min: u16) -> i64 {
    at(y, m, d, h, min).local_ms()
}
