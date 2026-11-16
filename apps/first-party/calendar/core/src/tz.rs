//! Time zones (Calendar design §3.4), behind a port: the core never holds a time-zone database.
//! The page's adapter is `Intl.DateTimeFormat`; the native tests' is `jiff`'s bundled tzdb. Both
//! answer the same two questions, and the rules for what the answers mean are here, once.
//!
//! - A **nonexistent** wall time (the spring-forward gap) moves forward by the gap: it is read
//!   with the offset in force before the transition, so 02:30 on a 02:00 -> 03:00 night is 03:30.
//! - An **ambiguous** wall time (the fall-back fold) takes its first occurrence, which is also the
//!   offset in force before the transition.
//!
//! There is no implicit zone anywhere: no UTC fallback, no "system" zone. A zone is named, or
//! there is no calendar (design §0.1, PCND).

use crate::civil::{CivilDateTime, MS_PER_MINUTE};
use alloc::string::String;
use serde::{Deserialize, Serialize};

/// The longest IANA name the core accepts (the longest in the database is 30 bytes).
pub const ZONE_NAME_MAX: usize = 64;

/// An IANA time-zone name ("America/Chicago"). Its syntax is checked here; whether the database
/// knows it is the port's to say.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, type = "string"))]
#[serde(try_from = "String", into = "String")]
pub struct Zone(String);

impl Zone {
    pub fn new(name: &str) -> Option<Self> {
        let printable = name
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"/_+-".contains(&b));
        let shaped = !name.is_empty() && name.len() <= ZONE_NAME_MAX && printable;
        let anchored = !name.starts_with('/') && !name.ends_with('/') && !name.contains("//");
        (shaped && anchored).then(|| Zone(String::from(name)))
    }

    pub fn name(&self) -> &str {
        &self.0
    }
}

impl TryFrom<String> for Zone {
    type Error = &'static str;
    fn try_from(name: String) -> Result<Self, Self::Error> {
        Zone::new(&name).ok_or("not an IANA zone name")
    }
}

impl From<Zone> for String {
    fn from(zone: Zone) -> Self {
        zone.0
    }
}

/// What a wall time is in a zone. Offsets are seconds east of UTC.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
#[serde(rename_all = "snake_case")]
pub enum Resolution {
    Unique {
        offset_s: i32,
    },
    /// The wall time was skipped: `before_s` was in force until the transition, `after_s` after.
    Gap {
        before_s: i32,
        after_s: i32,
    },
    /// The wall time happened twice: first with `first_s`, then with `second_s`.
    Fold {
        first_s: i32,
        second_s: i32,
    },
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TzError {
    /// The port's database has no zone of this name.
    UnknownZone(String),
    /// The instant or wall time is outside what the port can place.
    OutOfRange,
}

/// The two questions the core asks of a time-zone database.
pub trait TimeZonePort {
    /// The offset in force in `zone` at the instant `utc_ms`.
    fn offset_at(&self, zone: &Zone, utc_ms: i64) -> Result<i32, TzError>;
    /// What the wall time `local` is in `zone`.
    fn resolve(&self, zone: &Zone, local: CivilDateTime) -> Result<Resolution, TzError>;
}

/// The offset a wall time is read with, by the gap and fold rules above.
pub fn offset_for(resolution: Resolution) -> i32 {
    match resolution {
        Resolution::Unique { offset_s } => offset_s,
        Resolution::Gap { before_s, .. } => before_s,
        Resolution::Fold { first_s, .. } => first_s,
    }
}

/// The instant (UTC milliseconds) of the wall time `local` in `zone`.
pub fn instant_of(
    port: &dyn TimeZonePort,
    zone: &Zone,
    local: CivilDateTime,
) -> Result<i64, TzError> {
    let offset = offset_for(port.resolve(zone, local)?);
    Ok(local.local_ms() - i64::from(offset) * 1000)
}

/// The wall time, to the minute, that the instant `utc_ms` shows in `zone`.
pub fn civil_of(
    port: &dyn TimeZonePort,
    zone: &Zone,
    utc_ms: i64,
) -> Result<CivilDateTime, TzError> {
    let offset = port.offset_at(zone, utc_ms)?;
    let local = utc_ms + i64::from(offset) * 1000;
    CivilDateTime::from_local_ms(local - local.rem_euclid(MS_PER_MINUTE)).ok_or(TzError::OutOfRange)
}
