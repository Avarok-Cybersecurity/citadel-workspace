//! What the Calendar decides about an SDK request (Calendar design §3.8), pure: which requests
//! proceed, which wait for the member's consent, and which are refused; what an added or changed
//! event becomes; and the per-app limits. The instance supplies what it read (the caller the
//! kernel stamped, the member's stored consent, the stored event) and does what the answer says.

use crate::model::Visibility;
use crate::model::{
    Event, EventId, EventKind, EventStatus, NodeId, ReminderOffset, Source, Username, When,
};
use crate::propagation::check_propagation;
use crate::sdk::{EventPatch, Health, NewEvent, SdkCode, SdkRefusal};
use alloc::string::String;
use alloc::vec::Vec;
use serde::{Deserialize, Serialize};

pub use crate::sdk_gate::{
    gate, rate_admit, Consent, Gate, SdkAnswer, MAX_MUTATIONS_PER_WINDOW, RATE_WINDOW_MS,
};

/// The longest title, and the longest reference an app keeps for its event.
pub const MAX_TITLE_CHARS: usize = 200;
pub const MAX_REFERENCE_CHARS: usize = 200;
/// Events one app may keep in one member's calendar.
pub const MAX_EVENTS_PER_APP: usize = 500;

/// Where an SDK event is kept, and so where its index entry (`cal/sdk/index/<app>/<id>`) points.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
#[serde(rename_all = "snake_case")]
pub enum Placement {
    /// The member's own store: a private event.
    Private,
    /// What the member posts on the node, under their name.
    Authored { node: NodeId },
}

/// What the instance knows when an app adds an event.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
pub struct Adding {
    pub id: EventId,
    pub me: Username,
    pub app_id: String,
    /// How many events this app keeps in the member's calendar already.
    pub kept: u32,
    pub now_ms: u64,
}

fn invalid(detail: &str) -> SdkRefusal {
    SdkRefusal::new(SdkCode::Invalid, detail)
}

fn checked_title(title: &str) -> Result<String, SdkRefusal> {
    let title = title.trim();
    if title.is_empty() || title.chars().count() > MAX_TITLE_CHARS {
        return Err(invalid("a title of 1 to 200 characters"));
    }
    Ok(title.into())
}

fn checked_when(when: &When) -> Result<(), SdkRefusal> {
    let ok = match when {
        When::Once { start_ms, end_ms } => end_ms > start_ms,
        When::AllDay { days, .. } => *days >= 1,
        When::Recurring(r) => r.duration_min >= 1 && r.rule.interval >= 1,
    };
    if ok {
        Ok(())
    } else {
        Err(invalid("a time that ends after it starts"))
    }
}

fn checked_reminders(reminders: &[ReminderOffset]) -> Vec<ReminderOffset> {
    let mut out: Vec<ReminderOffset> = reminders.to_vec();
    out.sort_by_key(|r| r.minutes_before);
    out.dedup();
    out
}

/// The event an app's `NewEvent` becomes, and where it is kept; or why it is refused. An SDK
/// event is the member's own: posted on the node under their name, or private. It may be pulled
/// up, never pushed down, since only an editor's official event is written into the pages below.
pub fn new_event(req: &NewEvent, ctx: &Adding) -> Result<(Event, Placement), SdkRefusal> {
    if ctx.kept as usize >= MAX_EVENTS_PER_APP {
        return Err(SdkRefusal::new(
            SdkCode::Limit,
            "this app keeps 500 events in the member's calendar already",
        ));
    }
    let reference = req.reference.trim();
    if reference.is_empty() || reference.chars().count() > MAX_REFERENCE_CHARS {
        return Err(invalid("a reference of 1 to 200 characters"));
    }
    if req.propagate.down {
        return Err(invalid("an app's event is the member's own, and only a page's official events are shown below it"));
    }
    if req.node.is_empty() {
        return Err(invalid("no node"));
    }
    checked_when(&req.when)?;
    let event = Event {
        id: ctx.id.clone(),
        rev: 1,
        origin_node: req.node.clone(),
        author: ctx.me.clone(),
        title: checked_title(&req.title)?,
        body: None,
        kind: EventKind::Plain,
        status: EventStatus::Confirmed,
        when: req.when.clone(),
        zone: req.zone.clone(),
        location: req.location.clone(),
        hosts: alloc::vec![ctx.me.clone()],
        invitees: Vec::new(),
        visibility: req.visibility,
        propagate: req.propagate.clone(),
        reminders: checked_reminders(&req.reminders),
        notes_doc: None,
        source: Some(Source {
            app_id: ctx.app_id.clone(),
            reference: reference.into(),
        }),
        created_ms: ctx.now_ms,
        updated_ms: ctx.now_ms,
    };
    check_propagation(&event)
        .map_err(|_| invalid("a private event is never shown on another page"))?;
    let placement = match req.visibility {
        Visibility::Private => Placement::Private,
        _ => Placement::Authored {
            node: req.node.clone(),
        },
    };
    Ok((event, placement))
}

/// Whether `app_id` may change `event` at revision `rev`: only an event it added, and only at the
/// revision it is at now.
pub fn may_change(event: &Event, app_id: &str, rev: u32) -> Result<(), SdkRefusal> {
    if event.source.as_ref().map(|s| s.app_id.as_str()) != Some(app_id) {
        return Err(SdkRefusal::new(
            SdkCode::NotYours,
            "an app changes only the events it added",
        ));
    }
    if event.rev != rev {
        return Err(SdkRefusal::stale(event.rev));
    }
    Ok(())
}

/// `event` with `patch` applied, one revision on; or why not.
pub fn patched(
    event: &Event,
    patch: &EventPatch,
    app_id: &str,
    now_ms: u64,
) -> Result<Event, SdkRefusal> {
    may_change(event, app_id, patch.rev)?;
    let mut next = event.clone();
    if let Some(title) = &patch.title {
        next.title = checked_title(title)?;
    }
    if let Some(when) = &patch.when {
        checked_when(when)?;
        next.when = when.clone();
    }
    if let Some(zone) = &patch.zone {
        next.zone = zone.clone();
    }
    if let Some(location) = &patch.location {
        next.location = location.clone();
    }
    if let Some(reminders) = &patch.reminders {
        next.reminders = checked_reminders(reminders);
    }
    next.rev = event.rev.saturating_add(1);
    next.updated_ms = now_ms;
    Ok(next)
}

/// `/health`'s answer: the wire version this Calendar reads and writes, the codec's.
pub fn health() -> Health {
    Health {
        wire: crate::codec::VERSION,
    }
}
