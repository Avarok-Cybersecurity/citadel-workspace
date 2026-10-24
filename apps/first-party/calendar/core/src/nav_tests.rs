//! `nav`: month arithmetic clamps the day and carries years; a month's grid is whole Monday-first
//! weeks that hold every day of the month and nothing more than the edge weeks; a week is seven
//! contiguous days from its Monday; answers past year 9999 are absent, never wrapped.

use crate::civil::{days_in_month, CivilDate, Weekday};
use crate::nav::*;
use crate::test_tz::date;
use proptest::prelude::*;

#[test]
fn adding_months_clamps_to_the_target_months_length() {
    assert_eq!(add_months(date(2026, 1, 31), 1), Some(date(2026, 2, 28)));
    assert_eq!(add_months(date(2028, 1, 31), 1), Some(date(2028, 2, 29)));
    assert_eq!(add_months(date(2026, 3, 31), -1), Some(date(2026, 2, 28)));
    assert_eq!(add_months(date(2026, 12, 15), 1), Some(date(2027, 1, 15)));
    assert_eq!(add_months(date(2026, 1, 15), -1), Some(date(2025, 12, 15)));
    assert_eq!(add_months(date(9999, 12, 1), 1), None);
}

#[test]
fn october_2026_runs_from_monday_28_september_to_sunday_1_november() {
    let grid = month_grid(2026, 10).unwrap();
    assert_eq!(grid.len(), 35);
    assert_eq!(grid.first(), Some(&date(2026, 9, 28)));
    assert_eq!(grid.last(), Some(&date(2026, 11, 1)));
}

#[test]
fn a_february_that_starts_on_a_monday_is_four_rows() {
    assert_eq!(month_grid(2021, 2).unwrap().len(), 28);
    assert_eq!(month_grid(2026, 8).unwrap().len(), 42);
}

#[test]
fn the_last_month_has_no_grid_because_its_last_week_leaves_the_years() {
    assert_eq!(month_grid(9999, 12), None);
    assert_eq!(month_grid(2026, 13), None);
}

#[test]
fn a_week_is_monday_to_sunday_around_the_date() {
    let week = week_of(date(2026, 10, 24)).unwrap();
    assert_eq!(week.first(), Some(&date(2026, 10, 19)));
    assert_eq!(week.last(), Some(&date(2026, 10, 25)));
}

proptest! {
    #[test]
    fn every_grid_is_whole_weeks_holding_exactly_the_month_and_its_edge_weeks(year in 1i32..9999, month in 1u8..=12) {
        let grid = month_grid(year, month).unwrap();
        prop_assert_eq!(grid.len() % 7, 0);
        prop_assert!((28..=42).contains(&grid.len()));
        prop_assert_eq!(grid[0].weekday(), Weekday::Mon);
        for pair in grid.windows(2) {
            prop_assert_eq!(pair[0].add_days(1), Some(pair[1]));
        }
        let inside = grid.iter().filter(|d| d.year() == year && d.month() == month).count();
        prop_assert_eq!(inside, usize::from(days_in_month(year, month)));
        prop_assert!(grid[..7].iter().any(|d| d.day() == 1 && d.month() == month));
        prop_assert!(grid[grid.len() - 7..].iter().any(|d| d.month() == month && d.day() == days_in_month(year, month)));
    }

    #[test]
    fn a_month_there_and_back_returns_any_day_that_exists_in_both(year in 2i32..9998, month in 1u8..=12, day in 1u8..=28, months in -24i64..=24) {
        let start = CivilDate::new(year, month, day).unwrap();
        let there = add_months(start, months).unwrap();
        prop_assert_eq!(add_months(there, -months), Some(start));
    }
}
