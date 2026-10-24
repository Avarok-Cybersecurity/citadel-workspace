//! `civil`: day numbers agree with known dates and round-trip, weekdays and ISO weeks are right,
//! month arithmetic carries years, and impossible dates are not constructible or decodable.

use crate::civil::*;
use crate::test_tz::{at, date};
use proptest::prelude::*;

#[test]
fn day_numbers_match_known_dates() {
    assert_eq!(date(1970, 1, 1).day_number(), 0);
    assert_eq!(date(2000, 3, 1).day_number(), 11_017);
    assert_eq!(date(1969, 12, 31).day_number(), -1);
    assert_eq!(date(2026, 10, 24).day_number(), 20_750);
}

#[test]
fn weekdays_and_iso_weeks() {
    assert_eq!(date(1970, 1, 1).weekday(), Weekday::Thu);
    assert_eq!(date(2026, 10, 24).weekday(), Weekday::Sat);
    assert_eq!(date(2026, 10, 24).week_start(), Some(date(2026, 10, 19)));
    assert_eq!(date(2026, 10, 19).week_start(), Some(date(2026, 10, 19)));
}

#[test]
fn impossible_dates_are_refused_by_construction_and_by_decoding() {
    assert_eq!(CivilDate::new(2026, 2, 29), None);
    assert!(CivilDate::new(2028, 2, 29).is_some());
    assert_eq!(CivilDate::new(2026, 13, 1), None);
    assert_eq!(CivilDateTime::new(date(2026, 1, 1), MINUTES_PER_DAY), None);
    let forged = citadel_app_sdk_types::encode(&std::collections::BTreeMap::from([
        ("y", 2026),
        ("m", 2),
        ("d", 30),
    ]));
    assert!(citadel_app_sdk_types::decode::<CivilDate>(&forged).is_err());
}

#[test]
fn month_offsets_carry_years_both_ways() {
    assert_eq!(CivilDate::month_offset(2026, 11, 3), Some((2027, 2)));
    assert_eq!(CivilDate::month_offset(2026, 1, -1), Some((2025, 12)));
    assert_eq!(CivilDate::month_offset(9999, 12, 1), None);
}

#[test]
fn local_ms_round_trips_to_the_minute() {
    let t = at(2026, 3, 8, 2, 30);
    assert_eq!(CivilDateTime::from_local_ms(t.local_ms()), Some(t));
    assert_eq!(CivilDateTime::from_local_ms(t.local_ms() + 59_999), Some(t));
}

proptest! {
    #[test]
    fn every_day_number_round_trips(days in -719_162i64..2_932_896) {
        let d = CivilDate::from_day_number(days).expect("in range");
        prop_assert_eq!(d.day_number(), days);
        prop_assert_eq!(d.add_days(1).map(|n| n.day_number()), CivilDate::from_day_number(days + 1).map(|n| n.day_number()));
    }
}
