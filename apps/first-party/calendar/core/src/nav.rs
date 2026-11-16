//! Moving through the Calendar's grids (design §3.9, §3.10): the days a month or a week view
//! shows, and the month a PageUp/PageDown lands on. Weeks are ISO weeks, Monday first, as the
//! wireframes draw them. `None` means the answer lies outside `CivilDate`'s years.

use crate::civil::{days_in_month, CivilDate};
use alloc::vec::Vec;

/// `date` moved by `months`, its day clamped to the target month's length: 31 January plus one
/// month is the last day of February, never a day of March.
pub fn add_months(date: CivilDate, months: i64) -> Option<CivilDate> {
    let (year, month) = CivilDate::month_offset(date.year(), date.month(), months)?;
    CivilDate::new(year, month, date.day().min(days_in_month(year, month)))
}

/// The seven days of `date`'s week, Monday first.
pub fn week_of(date: CivilDate) -> Option<Vec<CivilDate>> {
    let monday = date.week_start()?;
    (0..7).map(|i| monday.add_days(i)).collect()
}

/// A month's grid: whole weeks, from the week holding the 1st to the week holding the last day,
/// so four to six rows of seven.
pub fn month_grid(year: i32, month: u8) -> Option<Vec<CivilDate>> {
    let first = CivilDate::new(year, month, 1)?;
    let last = CivilDate::new(year, month, days_in_month(year, month))?;
    let start = first.week_start()?;
    let end = last.week_start()?.add_days(6)?;
    (0..=end.day_number() - start.day_number())
        .map(|i| start.add_days(i))
        .collect()
}
