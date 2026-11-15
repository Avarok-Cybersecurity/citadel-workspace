//! A member's reminders (Calendar design §3.7): each event's offsets resolved to UTC instants when
//! the event is saved, kept in the member's own storage at `cal/reminders/<event_id>`, so a
//! scheduler fires them without re-reading the event, and a zone change cannot move one.

use alloc::string::String;
use alloc::vec::Vec;
use serde::{Deserialize, Serialize};

/// The most instants one plan holds: a recurring event's are resolved over a horizon, not forever.
pub const MAX_FIRES: usize = 64;

/// One reminder: when it fires, and when the occurrence it is for starts.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
pub struct Fire {
    pub at_ms: u64,
    pub start_ms: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
pub struct ReminderPlan {
    pub event_id: String,
    /// The node the event is on, which the reminder names.
    pub node: String,
    pub title: String,
    /// In time order; at most `MAX_FIRES`, none after the start it is for.
    pub fires: Vec<Fire>,
}
