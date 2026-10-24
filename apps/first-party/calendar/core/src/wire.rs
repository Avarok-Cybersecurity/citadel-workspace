//! The values the page hands the core and gets back through the glue (Calendar design §3.2):
//! owned forms of the borrowed queries, and the answers, each one TypeScript type the UI is
//! compiled against (`bindings/`, copied to the UI by `scripts/build-calendar-glue.mjs`).

use crate::civil::CivilDate;
use crate::model::{Event, NodeId, Username};
use crate::model_booking::{Availability, BookingRules};
use crate::slots::{Interval, SlotQuery};
use alloc::boxed::Box;
use alloc::collections::BTreeMap;
use alloc::string::String;
use alloc::vec::Vec;
use serde::{Deserialize, Serialize};

/// How many confirmed bookings a host has on a date, in the availability's zone.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
pub struct BookedDay {
    pub date: CivilDate,
    pub count: u8,
}

/// `SlotQuery`, owned.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
pub struct SlotRequest {
    pub availability: Availability,
    pub rules: BookingRules,
    pub duration_min: u16,
    pub busy: Vec<Interval>,
    pub booked: Vec<BookedDay>,
    pub now_ms: i64,
    pub from: CivilDate,
    pub to: CivilDate,
}

impl SlotRequest {
    /// The borrowed query, over `booked` as the map the core reads.
    pub fn with_query<R>(&self, run: impl FnOnce(&SlotQuery<'_>) -> R) -> R {
        let booked: BTreeMap<CivilDate, u8> =
            self.booked.iter().map(|b| (b.date, b.count)).collect();
        run(&SlotQuery {
            availability: &self.availability,
            rules: &self.rules,
            duration_min: self.duration_min,
            busy: &self.busy,
            booked: &booked,
            now_ms: self.now_ms,
            from: self.from,
            to: self.to,
        })
    }
}

/// A host's confirmed bookings in the strategy's period.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
pub struct HostCount {
    pub host: Username,
    pub confirmed: u32,
}

/// What a reader can read of a projection's origin.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
pub enum OriginRead {
    /// The reader may not read the origin node.
    Unreadable,
    /// Readable, and gone.
    Gone,
    Found {
        event: Box<Event>,
    },
}

/// `up_pull_targets`, owned.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
pub struct UpPull {
    pub targets: Vec<NodeId>,
    pub truncated: bool,
}

/// `ics_export::export`, owned.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
pub struct IcsFile {
    pub text: String,
    /// The ids of events no ICS date can hold.
    pub unwritten: Vec<String>,
}
