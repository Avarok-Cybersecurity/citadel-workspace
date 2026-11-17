//! Who sees which event (Calendar design §3.5): propagation moves the way rights already flow.
//!
//! - **Down is a push by the publisher.** An official event with `propagate.down` is projected
//!   into every descendant, at most `MAX_FAN_OUT` of them; the origin stays the SSOT and every
//!   projection names its revision. The plan is idempotent: running it again after a partial
//!   failure writes what is missing and rewrites what is there.
//! - **Up is a pull by the reader.** A node shows a descendant's event whose `up_to` is that node
//!   or one of its ancestors, from at most `MAX_UP_PULL` descendants.
//! - **Visibility at the edges.** `Private` never leaves its author's own storage, so it cannot
//!   propagate either way. A projection carries an allow-list of fields and nothing else; a
//!   `BusyOnly` event's carries no title.

use crate::model::{Event, EventStatus, LocationKind, NodeId, Username, Visibility, When};
use crate::tz::Zone;
use alloc::boxed::Box;
use alloc::format;
use alloc::string::String;
use alloc::vec::Vec;
use serde::{Deserialize, Serialize};

/// Nodes one event may be projected into (owner decision 5).
pub const MAX_FAN_OUT: usize = 256;
/// Descendants one reader pulls events up from (owner decision 5).
pub const MAX_UP_PULL: usize = 256;

/// What a descendant holds of an ancestor's event: these fields, and only these.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
pub struct Projection {
    /// None for a `BusyOnly` event: the reader sees "Busy".
    pub title: Option<String>,
    pub when: When,
    pub zone: Zone,
    pub location: LocationKind,
    pub hosts: Vec<Username>,
    pub origin_node: NodeId,
    pub origin_rev: u32,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum PropagationError {
    /// A private event names a direction to propagate in.
    PrivateCannotPropagate,
    /// The subtree is larger than `MAX_FAN_OUT`: "pick a closer page".
    TooManyNodes { count: usize },
}

/// One write of a fan-out, to `storage.node(node)`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
#[serde(rename_all = "snake_case")]
pub enum Write {
    Put {
        node: NodeId,
        key: String,
        projection: Box<Projection>,
    },
    Delete {
        node: NodeId,
        key: String,
    },
}

/// The key a projection of `event_id` from `origin` is held under in a descendant.
pub fn inherit_key(origin: &str, event_id: &str) -> String {
    format!("cal/inherit/{origin}/{event_id}")
}

/// Whether `event` may propagate as it says it does.
pub fn check_propagation(event: &Event) -> Result<(), PropagationError> {
    let wants = event.propagate.down || event.propagate.up_to.is_some();
    if event.visibility == Visibility::Private && wants {
        return Err(PropagationError::PrivateCannotPropagate);
    }
    Ok(())
}

/// The projection of `event`, by the allow-list.
pub fn project(event: &Event) -> Result<Projection, PropagationError> {
    check_propagation(event)?;
    if event.visibility == Visibility::Private {
        return Err(PropagationError::PrivateCannotPropagate);
    }
    Ok(Projection {
        title: (event.visibility == Visibility::Public).then(|| event.title.clone()),
        when: event.when.clone(),
        zone: event.zone.clone(),
        location: event.location.kind(),
        hosts: event.hosts.clone(),
        origin_node: event.origin_node.clone(),
        origin_rev: event.rev,
    })
}

/// The writes that bring `subtree` (the origin's descendants, not the origin) in line with
/// `event`: a projection into each while it propagates down and is not cancelled, else a delete.
pub fn fan_out_plan(event: &Event, subtree: &[NodeId]) -> Result<Vec<Write>, PropagationError> {
    check_propagation(event)?;
    let descendants: Vec<&NodeId> = subtree
        .iter()
        .filter(|n| **n != event.origin_node)
        .collect();
    if descendants.len() > MAX_FAN_OUT {
        return Err(PropagationError::TooManyNodes {
            count: descendants.len(),
        });
    }
    let key = inherit_key(&event.origin_node, &event.id);
    let live = event.propagate.down && event.status == EventStatus::Confirmed;
    let projection = if live { Some(project(event)?) } else { None };
    Ok(descendants
        .into_iter()
        .map(|node| match &projection {
            Some(p) => Write::Put {
                node: node.clone(),
                key: key.clone(),
                projection: Box::new(p.clone()),
            },
            None => Write::Delete {
                node: node.clone(),
                key: key.clone(),
            },
        })
        .collect())
}

/// Whether a reader at the node whose chain (itself, then each ancestor up to the root) is
/// `reader_chain` shows a descendant's `event` pulled up.
pub fn shown_up_at(event: &Event, reader_chain: &[NodeId]) -> bool {
    let reaches = event
        .propagate
        .up_to
        .as_ref()
        .is_some_and(|to| reader_chain.contains(to));
    let elsewhere = reader_chain
        .first()
        .is_some_and(|me| *me != event.origin_node);
    reaches && elsewhere && event.visibility != Visibility::Private
}

/// The descendants a reader pulls from, and whether there were more than `MAX_UP_PULL`.
pub fn up_pull_targets(descendants: &[NodeId]) -> (&[NodeId], bool) {
    let shown = descendants.len().min(MAX_UP_PULL);
    (&descendants[..shown], descendants.len() > MAX_UP_PULL)
}

/// What a reader does with a projection, given what it can read of the origin.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
#[serde(rename_all = "snake_case")]
pub enum Reconciled {
    /// The origin is unreadable to this reader: show the projection, without a link.
    ShowWithoutLink,
    /// The origin is readable and current: show it, with a link.
    Show,
    /// The origin is readable, gone or cancelled: hide the projection.
    Hide,
    /// The origin is readable and newer: show the origin's fields, and the plan rewrites it.
    Stale,
}

/// `origin`: None when the reader may not read it; Some(None) when it is readable and gone.
pub fn reconcile(projection: &Projection, origin: Option<Option<&Event>>) -> Reconciled {
    match origin {
        None => Reconciled::ShowWithoutLink,
        Some(None) => Reconciled::Hide,
        Some(Some(e)) if e.status != EventStatus::Confirmed || !e.propagate.down => {
            Reconciled::Hide
        }
        Some(Some(e)) if e.rev != projection.origin_rev => Reconciled::Stale,
        Some(Some(_)) => Reconciled::Show,
    }
}
