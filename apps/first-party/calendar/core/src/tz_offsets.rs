//! A `TimeZonePort` from offsets alone. The page's time-zone database is `Intl.DateTimeFormat`,
//! which answers one question: the offset in force at an instant. Whether a wall time is unique,
//! skipped or repeated is derived here from that, once, rather than in each adapter.
//!
//! The wall time `local` can only be the instant `local - o` for an offset `o` in force within the
//! span offsets reach (UTC-12 to UTC+14). The candidates are the offsets in force across that
//! span, sampled every `SAMPLE_MS`; each candidate instant that really has its offset is a reading.
//! Two readings are a fold (the earlier first), one is unique, none is a gap, whose offsets are
//! the pair either side of the skipped wall time. Nuuk (America/Godthab) has had transitions under
//! a day apart (2023), so sampling only a day either side is not enough; no zone in the database
//! has had two within `SAMPLE_MS` since 1970, which `tz_offsets_tests` checks against it.

use crate::civil::CivilDateTime;
use crate::tz::{Resolution, TimeZonePort, TzError, Zone};
use alloc::vec::Vec;

/// How far apart candidate offsets are sampled.
pub const SAMPLE_MS: i64 = 3 * 3_600_000;
/// The span sampled around a wall time: every offset in use lies within UTC-12 to UTC+14, with an
/// hour's margin either side.
const EARLIEST_MS: i64 = -15 * 3_600_000;
const LATEST_MS: i64 = 13 * 3_600_000;

/// The offset (seconds east of UTC) in force in `zone` at `utc_ms`.
pub trait OffsetSource {
    fn offset_at(&self, zone: &Zone, utc_ms: i64) -> Result<i32, TzError>;
}

/// The port an `OffsetSource` gives.
pub struct ByOffsets<S>(pub S);

impl<S: OffsetSource> ByOffsets<S> {
    fn candidates(&self, zone: &Zone, wall: i64) -> Result<Vec<i32>, TzError> {
        let mut offsets = Vec::new();
        let mut at = wall + EARLIEST_MS;
        while at <= wall + LATEST_MS {
            let offset = self.0.offset_at(zone, at)?;
            if !offsets.contains(&offset) {
                offsets.push(offset);
            }
            at += SAMPLE_MS;
        }
        Ok(offsets)
    }
}

impl<S: OffsetSource> TimeZonePort for ByOffsets<S> {
    fn offset_at(&self, zone: &Zone, utc_ms: i64) -> Result<i32, TzError> {
        self.0.offset_at(zone, utc_ms)
    }

    fn resolve(&self, zone: &Zone, local: CivilDateTime) -> Result<Resolution, TzError> {
        let wall = local.local_ms();
        let candidates = self.candidates(zone, wall)?;
        let mut readings: Vec<(i64, i32)> = Vec::new();
        let mut skipped: Option<(i32, i32)> = None;
        for offset in candidates {
            let at = wall - i64::from(offset) * 1000;
            let actual = self.0.offset_at(zone, at)?;
            if actual == offset {
                readings.push((at, offset));
            } else if skipped.is_none() {
                skipped = Some((offset.min(actual), offset.max(actual)));
            }
        }
        readings.sort();
        Ok(match (readings.as_slice(), skipped) {
            ([(_, first_s), .., (_, second_s)], _) => Resolution::Fold {
                first_s: *first_s,
                second_s: *second_s,
            },
            ([(_, offset_s)], _) => Resolution::Unique {
                offset_s: *offset_s,
            },
            ([], Some((before_s, after_s))) => Resolution::Gap { before_s, after_s },
            ([], None) => return Err(TzError::OutOfRange),
        })
    }
}
