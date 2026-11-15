//! The Calendar SDK's wire (Calendar design §3.8): the routes other apps reach the Calendar's
//! instance on, and every body and query that crosses them, defined once. The Calendar's instance
//! decodes requests and encodes answers with these (through the glue); the Rust guest crate
//! `citadel-calendar-sdk` and the page's TypeScript mirror build requests and read answers with
//! them, so the two ends cannot drift. Bodies are CBOR through the core's versioned codec.

use crate::model::{
    EventId, Location, NodeId, Propagate, ReminderOffset, Source, Username, Visibility, When,
};
use crate::slots::Interval;
use crate::tz::Zone;
use alloc::string::String;
use alloc::vec::Vec;
use citadel_app_sdk_types::calls::{HttpMethod, Route};
use serde::{Deserialize, Serialize};

pub use crate::sdk_refusal::{SdkCode, SdkRefusal};

/// The SDK's own paths, beside the booking routes (`/book`, `/book/:id/cancel|reschedule`).
pub const EVENTS_PATH: &str = "/events";
pub const FREE_BUSY_PATH: &str = "/free-busy";
pub const HEALTH_PATH: &str = "/health";

/// The routes the Calendar serves for the SDK, as its manifest's `ihttp.serve` lists them.
pub fn sdk_routes() -> Vec<Route> {
    let route = |method: HttpMethod, path: &str| Route {
        method,
        path: path.into(),
    };
    alloc::vec![
        route(HttpMethod::Get, EVENTS_PATH),
        route(HttpMethod::Post, EVENTS_PATH),
        route(HttpMethod::Patch, "/events/:id"),
        route(HttpMethod::Delete, "/events/:id"),
        route(HttpMethod::Get, FREE_BUSY_PATH),
        route(HttpMethod::Get, HEALTH_PATH),
    ]
}

/// The path of one event the SDK created.
pub fn event_path(id: &str) -> String {
    alloc::format!("{EVENTS_PATH}/{}", crate::sdk_query::escape(id))
}

/// Which SDK route a request is for.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
#[serde(rename_all = "snake_case")]
pub enum SdkRoute {
    List,
    Create,
    Patch { id: EventId },
    Delete { id: EventId },
    FreeBusy,
    Health,
}

impl SdkRoute {
    /// Whether the route changes the member's calendar (and so needs their consent, §3.8 layer 3).
    pub fn mutates(&self) -> bool {
        matches!(
            self,
            SdkRoute::Create | SdkRoute::Patch { .. } | SdkRoute::Delete { .. }
        )
    }
}

/// The SDK route `method path` names, or `None` for any other request.
pub fn sdk_route(method: &HttpMethod, path: &str) -> Option<SdkRoute> {
    match (method, path) {
        (HttpMethod::Get, EVENTS_PATH) => return Some(SdkRoute::List),
        (HttpMethod::Post, EVENTS_PATH) => return Some(SdkRoute::Create),
        (HttpMethod::Get, FREE_BUSY_PATH) => return Some(SdkRoute::FreeBusy),
        (HttpMethod::Get, HEALTH_PATH) => return Some(SdkRoute::Health),
        _ => {}
    }
    let id = path
        .strip_prefix("/events/")
        .filter(|rest| !rest.is_empty() && !rest.contains('/'))?;
    let id = crate::sdk_query::unescape(id)?;
    match method {
        HttpMethod::Patch => Some(SdkRoute::Patch { id }),
        HttpMethod::Delete => Some(SdkRoute::Delete { id }),
        _ => None,
    }
}

/// `POST /events`: an event an app adds to the member's calendar on `node`. The app is the
/// kernel-stamped caller's; `reference` is the app's own name for the event.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
pub struct NewEvent {
    pub node: NodeId,
    pub title: String,
    pub when: When,
    pub zone: Zone,
    pub location: Location,
    pub visibility: Visibility,
    pub propagate: Propagate,
    pub reminders: Vec<ReminderOffset>,
    pub reference: String,
}

/// `PATCH /events/:id`: the fields to change, at the revision the app last saw. Where an event
/// lives (its visibility and propagation) is fixed when it is added.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
pub struct EventPatch {
    pub rev: u32,
    pub title: Option<String>,
    pub when: Option<When>,
    pub zone: Option<Zone>,
    pub location: Option<Location>,
    pub reminders: Option<Vec<ReminderOffset>>,
}

/// `DELETE /events/:id`'s body, and `PATCH`'s answer: a revision.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
pub struct Rev {
    pub rev: u32,
}

/// `POST /events`' answer: the event's id and first revision.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
pub struct EventRef {
    pub id: EventId,
    pub rev: u32,
}

/// Which events `GET /events` reads on its node: its own, those projected from above, or those
/// pulled up from below (design §3.5).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
#[serde(rename_all = "snake_case")]
pub enum Include {
    Own,
    Inherited,
    Up,
}

/// `GET /events?node=&from=&to=&include=`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
pub struct ListQuery {
    pub node: NodeId,
    pub from_ms: i64,
    pub to_ms: i64,
    pub include: Include,
}

/// One event as an app reads it: what the member's calendar shows, never a private body.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
pub struct EventView {
    pub id: EventId,
    pub rev: u32,
    pub node: NodeId,
    /// None for an ancestor's busy-only event, of which a page holds no title.
    pub title: Option<String>,
    pub when: When,
    pub zone: Zone,
    /// None for an ancestor's event, of which a page holds the kind of place only.
    pub location: Option<Location>,
    pub visibility: Visibility,
    /// The app that added it, when one did; an app may change only its own.
    pub source: Option<Source>,
    pub include: Include,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
pub struct Events {
    pub events: Vec<EventView>,
}

/// `GET /free-busy?node=&users=a,b&from=&to=`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
pub struct FreeBusyQuery {
    pub node: NodeId,
    pub users: Vec<Username>,
    pub from_ms: i64,
    pub to_ms: i64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
pub struct UserBusy {
    pub user: Username,
    pub busy: Vec<Interval>,
}

/// Each asked-for member's busy intervals on the node, in the order asked.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
pub struct FreeBusy {
    pub users: Vec<UserBusy>,
}

/// `GET /health`: the SDK wire version the Calendar speaks.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
pub struct Health {
    pub wire: u8,
}
