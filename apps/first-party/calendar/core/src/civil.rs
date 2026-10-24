//! Civil (wall-clock) dates and times, with no zone: what a person reads on a calendar. The
//! proleptic Gregorian calendar; day numbers count from 1970-01-01. Instants are elsewhere
//! (`tz`), because turning a civil time into one takes a zone.

use serde::{Deserialize, Serialize};

pub const MINUTES_PER_DAY: u16 = 24 * 60;
pub const MS_PER_MINUTE: i64 = 60_000;
pub const MS_PER_DAY: i64 = 86_400_000;

/// A calendar date. Constructed only through [`CivilDate::new`], so it is always a real date.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(try_from = "RawDate", into = "RawDate")]
pub struct CivilDate {
    year: i32,
    month: u8,
    day: u8,
}

#[derive(Serialize, Deserialize)]
struct RawDate {
    y: i32,
    m: u8,
    d: u8,
}

impl TryFrom<RawDate> for CivilDate {
    type Error = &'static str;
    fn try_from(raw: RawDate) -> Result<Self, Self::Error> {
        CivilDate::new(raw.y, raw.m, raw.d).ok_or("not a calendar date")
    }
}

impl From<CivilDate> for RawDate {
    fn from(d: CivilDate) -> Self {
        RawDate {
            y: d.year,
            m: d.month,
            d: d.day,
        }
    }
}

/// Monday first, as ISO 8601 numbers weeks.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Weekday {
    Mon,
    Tue,
    Wed,
    Thu,
    Fri,
    Sat,
    Sun,
}

impl Weekday {
    pub const ALL: [Weekday; 7] = [
        Weekday::Mon,
        Weekday::Tue,
        Weekday::Wed,
        Weekday::Thu,
        Weekday::Fri,
        Weekday::Sat,
        Weekday::Sun,
    ];

    /// 0 for Monday through 6 for Sunday.
    pub fn index(self) -> usize {
        self as usize
    }
}

pub fn is_leap(year: i32) -> bool {
    (year % 4 == 0 && year % 100 != 0) || year % 400 == 0
}

pub fn days_in_month(year: i32, month: u8) -> u8 {
    match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if is_leap(year) => 29,
        2 => 28,
        _ => 0,
    }
}

impl CivilDate {
    /// The date, if `year-month-day` is one; years 1..=9999, as the IANA data and ICS cover.
    pub fn new(year: i32, month: u8, day: u8) -> Option<Self> {
        let real = (1..=9999).contains(&year) && day >= 1 && day <= days_in_month(year, month);
        real.then_some(CivilDate { year, month, day })
    }

    pub fn year(self) -> i32 {
        self.year
    }

    pub fn month(self) -> u8 {
        self.month
    }

    pub fn day(self) -> u8 {
        self.day
    }

    /// Days since 1970-01-01 (negative before it). Hinnant's `days_from_civil`.
    pub fn day_number(self) -> i64 {
        let y = i64::from(self.year) - i64::from(self.month <= 2);
        let era = y.div_euclid(400);
        let yoe = y - era * 400;
        let m = i64::from(self.month);
        let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + i64::from(self.day) - 1;
        let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
        era * 146_097 + doe - 719_468
    }

    /// The date `days` after 1970-01-01, if it is within [`CivilDate::new`]'s years.
    pub fn from_day_number(days: i64) -> Option<Self> {
        let z = days + 719_468;
        let era = z.div_euclid(146_097);
        let doe = z - era * 146_097;
        let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
        let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
        let mp = (5 * doy + 2) / 153;
        let day = u8::try_from(doy - (153 * mp + 2) / 5 + 1).ok()?;
        let month = u8::try_from(if mp < 10 { mp + 3 } else { mp - 9 }).ok()?;
        let year = i32::try_from(yoe + era * 400 + i64::from(month <= 2)).ok()?;
        CivilDate::new(year, month, day)
    }

    pub fn add_days(self, days: i64) -> Option<Self> {
        Self::from_day_number(self.day_number() + days)
    }

    pub fn weekday(self) -> Weekday {
        // 1970-01-01 was a Thursday (index 3).
        Weekday::ALL[(self.day_number() + 3).rem_euclid(7) as usize]
    }

    /// The Monday of this date's ISO week.
    pub fn week_start(self) -> Option<Self> {
        self.add_days(-(self.weekday().index() as i64))
    }

    /// `(year, month)` moved by `months`, for iterating a monthly rule.
    pub fn month_offset(year: i32, month: u8, months: i64) -> Option<(i32, u8)> {
        let index = i64::from(year) * 12 + i64::from(month) - 1 + months;
        let year = i32::try_from(index.div_euclid(12)).ok()?;
        let month = u8::try_from(index.rem_euclid(12) + 1).ok()?;
        (1..=9999).contains(&year).then_some((year, month))
    }
}

/// A wall-clock time on a date: `minute` of the day, 0 to 1439.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(try_from = "RawDateTime", into = "RawDateTime")]
pub struct CivilDateTime {
    date: CivilDate,
    minute: u16,
}

#[derive(Serialize, Deserialize)]
struct RawDateTime {
    date: CivilDate,
    minute: u16,
}

impl TryFrom<RawDateTime> for CivilDateTime {
    type Error = &'static str;
    fn try_from(raw: RawDateTime) -> Result<Self, Self::Error> {
        CivilDateTime::new(raw.date, raw.minute).ok_or("minute of the day out of range")
    }
}

impl From<CivilDateTime> for RawDateTime {
    fn from(t: CivilDateTime) -> Self {
        RawDateTime {
            date: t.date,
            minute: t.minute,
        }
    }
}

impl CivilDateTime {
    pub fn new(date: CivilDate, minute: u16) -> Option<Self> {
        (minute < MINUTES_PER_DAY).then_some(CivilDateTime { date, minute })
    }

    pub fn date(self) -> CivilDate {
        self.date
    }

    pub fn minute(self) -> u16 {
        self.minute
    }

    /// Milliseconds since 1970-01-01T00:00 of this wall time read as if it were UTC: the "local
    /// milliseconds" a zone's offset is subtracted from to give an instant.
    pub fn local_ms(self) -> i64 {
        self.date.day_number() * MS_PER_DAY + i64::from(self.minute) * MS_PER_MINUTE
    }

    /// The wall time `local_ms` milliseconds after 1970-01-01T00:00, to the minute (seconds are
    /// dropped: a calendar is minute-grained).
    pub fn from_local_ms(local_ms: i64) -> Option<Self> {
        let date = CivilDate::from_day_number(local_ms.div_euclid(MS_PER_DAY))?;
        let minute = u16::try_from(local_ms.rem_euclid(MS_PER_DAY) / MS_PER_MINUTE).ok()?;
        CivilDateTime::new(date, minute)
    }
}
