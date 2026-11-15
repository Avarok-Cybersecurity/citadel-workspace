//! What an app reads of the member's calendar through the SDK (Calendar design §3.8): the
//! member's own events as they are, less any body and anything cancelled, and an ancestor's
//! events as the page's projection holds them, which is all the page has of them.

use crate::model::{Event, EventStatus, Visibility};
use crate::propagation::Projection;
use crate::sdk::{EventView, Include};

/// How an app reads one of the member's events: none of a cancelled one, never a body.
pub fn view_of(event: &Event, include: Include) -> Option<EventView> {
    if event.status != EventStatus::Confirmed {
        return None;
    }
    Some(EventView {
        id: event.id.clone(),
        rev: event.rev,
        node: event.origin_node.clone(),
        title: Some(event.title.clone()),
        when: event.when.clone(),
        zone: event.zone.clone(),
        location: Some(event.location.clone()),
        visibility: event.visibility,
        source: event.source.clone(),
        include,
    })
}

/// How an app reads an ancestor's event projected onto the page: what the projection holds.
pub fn projection_view(event_id: &str, projection: &Projection) -> EventView {
    EventView {
        id: event_id.into(),
        rev: projection.origin_rev,
        node: projection.origin_node.clone(),
        title: projection.title.clone(),
        when: projection.when.clone(),
        zone: projection.zone.clone(),
        location: None,
        visibility: if projection.title.is_some() {
            Visibility::Public
        } else {
            Visibility::BusyOnly
        },
        source: None,
        include: Include::Inherited,
    }
}
