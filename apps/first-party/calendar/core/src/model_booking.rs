//! Availability, event types and bookings (Calendar design §3.3.2, §3.6): what a booking page
//! offers and what a booking records.

use crate::civil::CivilDate;
use crate::model::Username;
use crate::tz::Zone;
use alloc::string::String;
use alloc::vec::Vec;
use serde::{Deserialize, Serialize};

/// `[start_min, end_min)` minutes of a day, in an availability's zone.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct Window {
    pub start_min: u16,
    pub end_min: u16,
}

/// A named weekly schedule, with date-specific overrides; a member may keep several.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Availability {
    pub id: String,
    pub name: String,
    pub zone: Zone,
    /// Monday first; an empty day is unavailable.
    pub weekly: [Vec<Window>; 7],
    pub overrides: Vec<DateOverride>,
}

/// One date's hours in place of its weekday's; no windows is unavailable that day.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct DateOverride {
    pub date: CivilDate,
    pub windows: Vec<Window>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct EventType {
    pub id: String,
    pub name: String,
    pub kind: TypeKind,
    pub durations_min: Vec<u16>,
    pub rules: BookingRules,
    pub questions: Vec<Question>,
    pub color: ColorToken,
    /// A managed type: descendants inherit it and may not edit it.
    pub locked: bool,
    /// Slots are always shown in this zone, whatever the booker's.
    pub zone_lock: Option<Zone>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TypeKind {
    OneOnOne,
    /// One host, at most `seats` invitees per slot.
    Group {
        seats: u16,
    },
    /// Several hosts, all of whom must be free.
    Collective {
        hosts: Vec<Username>,
    },
    /// One of several hosts, chosen by `strategy`.
    RoundRobin {
        hosts: Vec<Username>,
        strategy: Strategy,
    },
    /// Members vote on proposed slots; the host picks one.
    Poll,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Strategy {
    /// The host with the fewest confirmed bookings in the period; ties by name.
    Equal,
    /// The highest weight first; ties by name.
    Priority { weights: Vec<(Username, u16)> },
    /// The first listed host who is free.
    Availability,
}

/// The six token pairs an event type may be coloured with (design §3.9); never a raw colour.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ColorToken {
    Primary,
    Success,
    Warning,
    DestructiveEmphasis,
    Accent,
    Secondary,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Question {
    pub id: String,
    pub label: String,
    pub kind: QuestionKind,
    pub required: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum QuestionKind {
    Text,
    LongText,
    Choice { options: Vec<String> },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct BookingRules {
    pub buffer_before_min: u16,
    pub buffer_after_min: u16,
    pub min_notice_min: u32,
    pub max_per_day: Option<u8>,
    /// Slots start every `increment_min` minutes from a window's start; at least 5.
    pub increment_min: u8,
    pub range: DateRange,
    pub cancel_policy: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DateRange {
    /// From now to `days` days ahead.
    Rolling {
        days: u16,
    },
    /// These dates, inclusive, in the availability's zone.
    Fixed {
        from: CivilDate,
        to: CivilDate,
    },
    Indefinite,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Booking {
    pub id: String,
    pub page: PageRef,
    pub type_id: String,
    pub host: Username,
    pub booker: Booker,
    pub start_ms: u64,
    pub end_ms: u64,
    /// The zone the booker saw the slot in.
    pub zone: Zone,
    pub answers: Vec<Answer>,
    pub state: BookingState,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PageRef {
    Member { username: Username, slug: String },
    Node { node_id: String, slug: String },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Booker {
    Member {
        username: Username,
    },
    /// A booking-guest account (owner decision 6a, a later wave).
    Guest {
        account: String,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Answer {
    pub question_id: String,
    pub value: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BookingState {
    Requested,
    Confirmed,
    Declined,
    Cancelled {
        by: Username,
        reason: Option<String>,
    },
    Rescheduled {
        from: String,
    },
}
