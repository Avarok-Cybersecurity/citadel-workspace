//! Events (Calendar design §3.3.2): what is stored, every value versioned by `codec`. Instants
//! are `u64` milliseconds UTC; wall-clock fields are civil values beside the `Zone` they mean.
//! Availability, event types and bookings are `model_booking`.

use crate::civil::{CivilDate, CivilDateTime, Weekday};
use crate::tz::Zone;
use alloc::string::String;
use alloc::vec::Vec;
use serde::{Deserialize, Serialize};

pub type EventId = String;
pub type NodeId = String;
pub type Username = String;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Event {
    pub id: EventId,
    pub rev: u32,
    /// The node the event belongs to: its SSOT is there, every projection names it.
    pub origin_node: NodeId,
    pub author: Username,
    pub title: String,
    pub body: Option<String>,
    pub kind: EventKind,
    pub status: EventStatus,
    pub when: When,
    /// The zone the event was made in: what a recurring event's wall times mean, and what a
    /// one-off event shows its zone badge from.
    pub zone: Zone,
    pub location: Location,
    pub hosts: Vec<Username>,
    pub invitees: Vec<Invitee>,
    pub visibility: Visibility,
    pub propagate: Propagate,
    pub reminders: Vec<ReminderOffset>,
    pub notes_doc: Option<String>,
    /// The app that created it through the Calendar SDK (design §3.8), if one did.
    pub source: Option<Source>,
    pub created_ms: u64,
    pub updated_ms: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EventKind {
    Plain,
    /// The event a confirmed booking made.
    Booking {
        booking_id: String,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EventStatus {
    Confirmed,
    Cancelled {
        by: Username,
        reason: Option<String>,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum When {
    Once {
        start_ms: u64,
        end_ms: u64,
    },
    /// `days` whole days from `date`, in the event's zone.
    AllDay {
        date: CivilDate,
        days: u16,
    },
    Recurring(Recurrence),
}

/// A recurring event: wall-clock `start` in the event's zone, expanded per occurrence in that
/// zone (`rrule`), so "09:00 every Monday" stays 09:00 across a DST change.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Recurrence {
    pub start: CivilDateTime,
    pub duration_min: u32,
    pub rule: RRule,
    /// Dates (in the event's zone) whose occurrence is skipped.
    pub exdates: Vec<CivilDate>,
    /// No occurrence starts after this instant.
    pub until_ms: Option<u64>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Freq {
    Daily,
    Weekly,
    Monthly,
    Yearly,
}

/// The RFC 5545 subset the Calendar makes and reads.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct RRule {
    pub freq: Freq,
    /// Every `interval` periods; at least 1.
    pub interval: u16,
    /// Weekly: the weekdays; empty is the start's weekday.
    pub by_day: Vec<Weekday>,
    /// Monthly: days of the month, negative from the end (-1 the last); empty is the start's day.
    pub by_month_day: Vec<i8>,
    /// At most this many occurrences, counted before `exdates` are skipped (as RFC 5545 counts).
    pub count: Option<u32>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Location {
    /// A call in the node's chat (`GroupCallControls`).
    InApp,
    InPerson {
        address: String,
    },
    Text {
        text: String,
    },
}

impl Location {
    /// The kind alone, which is all a projection carries.
    pub fn kind(&self) -> LocationKind {
        match self {
            Location::InApp => LocationKind::InApp,
            Location::InPerson { .. } => LocationKind::InPerson,
            Location::Text { .. } => LocationKind::Text,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LocationKind {
    InApp,
    InPerson,
    Text,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Invitee {
    Member {
        username: Username,
    },
    /// External, reached by email only (owner decision 6c).
    Email {
        address: String,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Visibility {
    Public,
    /// Shown to others as a busy interval with no title.
    BusyOnly,
    /// Never leaves the author's `storage.user`.
    Private,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Propagate {
    /// Projected into every descendant of the origin node (design §3.5).
    pub down: bool,
    /// Pulled up by readers at this node and every node between it and the origin.
    pub up_to: Option<NodeId>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReminderOffset {
    pub minutes_before: u32,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Source {
    pub app_id: String,
    /// The app's own reference for the event.
    pub reference: String,
}
