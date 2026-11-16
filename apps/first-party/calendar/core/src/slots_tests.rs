//! `slots`: a booking page offers exactly the slots that fit the windows, start late enough,
//! fall in the range, leave room for their buffers, and sit on a day below its cap; the host's
//! claim check agrees, and malformed rules or ranges are said.

use crate::civil::{CivilDate, Weekday};
use crate::model_booking::*;
use crate::slots::*;
use crate::test_tz::{date, utc, zone, Jiff};
use std::collections::BTreeMap;
use std::vec;
use std::vec::Vec;

pub(crate) fn nine_to_noon(tz: &str) -> Availability {
    let day = vec![Window {
        start_min: 9 * 60,
        end_min: 12 * 60,
    }];
    let mut weekly: [Vec<Window>; 7] = Default::default();
    for d in [
        Weekday::Mon,
        Weekday::Tue,
        Weekday::Wed,
        Weekday::Thu,
        Weekday::Fri,
    ] {
        weekly[d.index()] = day.clone();
    }
    Availability {
        id: "work".into(),
        name: "Working hours".into(),
        zone: zone(tz),
        weekly,
        overrides: vec![],
    }
}

pub(crate) fn rules() -> BookingRules {
    BookingRules {
        buffer_before_min: 0,
        buffer_after_min: 0,
        min_notice_min: 0,
        max_per_day: None,
        increment_min: 30,
        range: DateRange::Indefinite,
        cancel_policy: None,
    }
}

struct Ask {
    availability: Availability,
    rules: BookingRules,
    busy: Vec<Interval>,
    booked: BTreeMap<CivilDate, u8>,
    now_ms: i64,
    days: (CivilDate, CivilDate),
}

impl Ask {
    fn new(tz: &str) -> Self {
        let day = date(2026, 10, 5);
        Ask {
            availability: nine_to_noon(tz),
            rules: rules(),
            busy: vec![],
            booked: BTreeMap::new(),
            now_ms: 0,
            days: (day, day),
        }
    }

    fn starts(&self) -> Vec<i64> {
        let q = SlotQuery {
            availability: &self.availability,
            rules: &self.rules,
            duration_min: 60,
            busy: &self.busy,
            booked: &self.booked,
            now_ms: self.now_ms,
            from: self.days.0,
            to: self.days.1,
        };
        free_slots(&Jiff, &q)
            .expect("slots")
            .iter()
            .map(|s| s.start_ms)
            .collect()
    }
}

fn h(hour: u16, min: u16) -> i64 {
    utc(2026, 10, 5, hour, min)
}

#[test]
fn slots_fill_the_window_at_the_increment_in_the_availability_s_zone() {
    let ask = Ask::new("America/New_York");
    // 09:00-12:00 EDT is 13:00-16:00Z; an hour fits from 09:00 to 11:00 every 30 minutes.
    assert_eq!(
        ask.starts(),
        [h(13, 0), h(13, 30), h(14, 0), h(14, 30), h(15, 0)]
    );
}

#[test]
fn minimum_notice_drops_the_slots_that_start_too_soon() {
    let mut ask = Ask::new("UTC");
    ask.now_ms = h(8, 0);
    ask.rules.min_notice_min = 120;
    assert_eq!(ask.starts(), [h(10, 0), h(10, 30), h(11, 0)]);
}

#[test]
fn buffers_keep_a_slot_clear_of_busy_time_on_both_sides() {
    let mut ask = Ask::new("UTC");
    ask.busy = vec![Interval {
        start_ms: h(10, 30),
        end_ms: h(11, 0),
    }];
    assert_eq!(ask.starts(), [h(9, 0), h(9, 30), h(11, 0)]);
    ask.rules.buffer_after_min = 15;
    ask.rules.buffer_before_min = 15;
    assert_eq!(
        ask.starts(),
        [h(9, 0)],
        "09:30 ends at 10:30 plus 15; 11:00 starts 15 after it"
    );
}

#[test]
fn a_day_at_its_cap_offers_nothing_and_an_override_replaces_the_weekday() {
    let mut ask = Ask::new("UTC");
    ask.rules.max_per_day = Some(2);
    ask.booked.insert(date(2026, 10, 5), 2);
    assert_eq!(ask.starts(), Vec::<i64>::new());
    ask.booked.insert(date(2026, 10, 5), 1);
    assert_eq!(ask.starts().len(), 5);
    ask.availability.overrides = vec![DateOverride {
        date: date(2026, 10, 5),
        windows: vec![Window {
            start_min: 14 * 60,
            end_min: 15 * 60,
        }],
    }];
    assert_eq!(ask.starts(), [h(14, 0)]);
    ask.availability.overrides[0].windows.clear();
    assert_eq!(
        ask.starts(),
        Vec::<i64>::new(),
        "an override with no hours is a day off"
    );
}

#[test]
fn the_date_range_bounds_which_days_offer_slots() {
    let mut ask = Ask::new("UTC");
    ask.days = (date(2026, 10, 5), date(2026, 10, 9));
    ask.now_ms = utc(2026, 10, 5, 0, 0);
    ask.rules.range = DateRange::Rolling { days: 2 };
    let last = *ask.starts().last().expect("some");
    assert!(
        last <= utc(2026, 10, 7, 0, 0),
        "nothing past two days from now"
    );
    ask.rules.range = DateRange::Fixed {
        from: date(2026, 10, 8),
        to: date(2026, 10, 8),
    };
    let starts = ask.starts();
    assert!(starts
        .iter()
        .all(|s| (utc(2026, 10, 8, 0, 0)..utc(2026, 10, 9, 0, 0)).contains(s)));
    assert_eq!(starts.len(), 5);
}

#[test]
fn the_claim_check_agrees_with_the_page_and_refuses_a_slot_it_does_not_offer() {
    let ask = Ask::new("UTC");
    let q = SlotQuery {
        availability: &ask.availability,
        rules: &ask.rules,
        duration_min: 60,
        busy: &ask.busy,
        booked: &ask.booked,
        now_ms: 0,
        from: ask.days.0,
        to: ask.days.1,
    };
    let offered = Interval {
        start_ms: h(9, 0),
        end_ms: h(10, 0),
    };
    assert_eq!(offers(&Jiff, &q, offered), Ok(true));
    let between = Interval {
        start_ms: h(9, 15),
        end_ms: h(10, 15),
    };
    assert_eq!(offers(&Jiff, &q, between), Ok(false));
}

#[test]
fn malformed_rules_and_ranges_are_said() {
    let mut ask = Ask::new("UTC");
    ask.rules.increment_min = 1;
    let q = |a: &Ask, from: CivilDate, to: CivilDate| -> Result<Vec<Interval>, SlotError> {
        free_slots(
            &Jiff,
            &SlotQuery {
                availability: &a.availability,
                rules: &a.rules,
                duration_min: 60,
                busy: &a.busy,
                booked: &a.booked,
                now_ms: 0,
                from,
                to,
            },
        )
    };
    assert_eq!(
        q(&ask, date(2026, 10, 5), date(2026, 10, 5)),
        Err(SlotError::BadRules)
    );
    ask.rules.increment_min = 30;
    assert_eq!(
        q(&ask, date(2026, 10, 6), date(2026, 10, 5)),
        Err(SlotError::BadRange)
    );
    assert_eq!(
        q(&ask, date(2026, 1, 1), date(2027, 1, 3)),
        Err(SlotError::BadRange)
    );
    ask.availability.weekly[0] = vec![Window {
        start_min: 600,
        end_min: 600,
    }];
    assert_eq!(
        q(&ask, date(2026, 10, 5), date(2026, 10, 5)),
        Err(SlotError::BadRules)
    );
}
