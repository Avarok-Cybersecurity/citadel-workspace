//! calendar-glue: calendar-core for the page (Calendar design §3.2, the glue ABI). Every export
//! is a function of its arguments and of the page's time-zone database, which the page hands in
//! as one function, `offsetAt(zone, utcMs) -> seconds | null`; whether a wall time is unique,
//! skipped or repeated is derived from it in the core (`tz_offsets`). Nothing here reaches
//! storage, the network or a clock: the page's ports do, and pass what they read in.
//!
//! Values cross in the shapes of calendar-core's TypeScript bindings (`values`). A refusal is
//! thrown as the core's `Refusal`.

mod nav;
mod offsets;
mod team;
mod values;

use calendar_core::model::Event;
use calendar_core::model_booking::{Availability, Booking, EventType};
use calendar_core::poll::{Poll, PollVote};
use calendar_core::propagation::{self, Projection};
use calendar_core::refusal::Refusal;
use calendar_core::reminder::ReminderPlan;
use calendar_core::routing::RoutingForm;
use calendar_core::slots::{self, Interval};
use calendar_core::tz::{self, TimeZonePort, Zone};
use calendar_core::tz_offsets::ByOffsets;
use calendar_core::wire::{HostCount, IcsFile, OriginRead, PropagationBounds, SlotRequest, UpPull};
use calendar_core::{codec, hosts, ics_export, ics_import, rrule, topic};
use offsets::JsOffsets;
use values::{from_js, refused, to_js};
use wasm_bindgen::prelude::*;

type Answer = Result<JsValue, JsValue>;

/// The core's zoned questions, bound to the page's offsets.
#[wasm_bindgen]
pub struct CalendarEngine {
    port: ByOffsets<JsOffsets>,
}

#[wasm_bindgen]
impl CalendarEngine {
    /// `offset_at(zone: string, utcMs: number): number | null`, seconds east of UTC.
    #[wasm_bindgen(constructor)]
    pub fn new(offset_at: js_sys::Function) -> CalendarEngine {
        CalendarEngine {
            port: ByOffsets(JsOffsets::new(offset_at)),
        }
    }

    /// Runs `body` on the port. A fault of the page's function wins over the refusal it caused.
    fn zoned<T: serde::Serialize, E: Into<Refusal>>(
        &self,
        body: impl FnOnce(&ByOffsets<JsOffsets>) -> Result<T, E>,
    ) -> Answer {
        let answer = body(&self.port);
        self.port.0.take_fault()?;
        to_js(&answer.map_err(refused)?)
    }

    pub fn resolve(&self, zone: JsValue, local: JsValue) -> Answer {
        let (zone, local) = (from_js::<Zone>(zone)?, from_js(local)?);
        self.zoned(|p| p.resolve(&zone, local))
    }

    #[wasm_bindgen(js_name = instantOf)]
    pub fn instant_of(&self, zone: JsValue, local: JsValue) -> Answer {
        let (zone, local) = (from_js::<Zone>(zone)?, from_js(local)?);
        self.zoned(|p| tz::instant_of(p, &zone, local))
    }

    #[wasm_bindgen(js_name = civilOf)]
    pub fn civil_of(&self, zone: JsValue, utc_ms: JsValue) -> Answer {
        let (zone, utc_ms) = (from_js::<Zone>(zone)?, from_js::<i64>(utc_ms)?);
        self.zoned(|p| tz::civil_of(p, &zone, utc_ms))
    }

    /// The occurrences of a recurrence, its wall times in `zone`, that overlap `[fromMs, toMs)`.
    pub fn expand(
        &self,
        recurrence: JsValue,
        zone: JsValue,
        from_ms: JsValue,
        to_ms: JsValue,
    ) -> Answer {
        let (rec, zone) = (from_js(recurrence)?, from_js::<Zone>(zone)?);
        let (from_ms, to_ms) = (from_js::<i64>(from_ms)?, from_js::<i64>(to_ms)?);
        self.zoned(|p| rrule::expand(p, &rec, &zone, from_ms, to_ms))
    }

    #[wasm_bindgen(js_name = freeSlots)]
    pub fn free_slots(&self, request: JsValue) -> Answer {
        let request = from_js::<SlotRequest>(request)?;
        self.zoned(|p| request.with_query(|q| slots::free_slots(p, q)))
    }

    /// Whether the request offers `slot`: what a host's instance asks before it claims.
    pub fn offers(&self, request: JsValue, slot: JsValue) -> Answer {
        let (request, slot) = (from_js::<SlotRequest>(request)?, from_js::<Interval>(slot)?);
        self.zoned(|p| request.with_query(|q| slots::offers(p, q, slot)))
    }

    /// The VEVENTs of an ICS file as drafts, floating times read in `floating`.
    #[wasm_bindgen(js_name = importIcs)]
    pub fn import_ics(&self, text: String, floating: JsValue) -> Answer {
        let floating = from_js::<Zone>(floating)?;
        self.zoned(|p| ics_import::import(p, &text, &floating))
    }
}

/// The free hosts, in the order a booking tries them.
#[wasm_bindgen(js_name = rankHosts)]
pub fn rank_hosts(strategy: JsValue, hosts: JsValue, free: JsValue, confirmed: JsValue) -> Answer {
    let strategy = from_js(strategy)?;
    let (hosts, free) = (
        from_js::<Vec<String>>(hosts)?,
        from_js::<Vec<String>>(free)?,
    );
    let confirmed = from_js::<Vec<HostCount>>(confirmed)?
        .into_iter()
        .map(|c| (c.host, c.confirmed))
        .collect();
    let is_free = |h: &str| free.iter().any(|f| f == h);
    to_js(&hosts::rank_hosts(&strategy, &hosts, &is_free, &confirmed))
}

#[wasm_bindgen(js_name = collectiveSlots)]
pub fn collective_slots(per_host: JsValue) -> Answer {
    to_js(&hosts::collective_slots(&from_js::<Vec<Vec<Interval>>>(
        per_host,
    )?))
}

#[wasm_bindgen(js_name = fanOutPlan)]
pub fn fan_out_plan(event: JsValue, subtree: JsValue) -> Answer {
    let (event, subtree) = (from_js::<Event>(event)?, from_js::<Vec<String>>(subtree)?);
    to_js(&propagation::fan_out_plan(&event, &subtree).map_err(refused)?)
}

#[wasm_bindgen(js_name = shownUpAt)]
pub fn shown_up_at(event: JsValue, reader_chain: JsValue) -> Answer {
    let (event, chain) = (
        from_js::<Event>(event)?,
        from_js::<Vec<String>>(reader_chain)?,
    );
    to_js(&propagation::shown_up_at(&event, &chain))
}

#[wasm_bindgen(js_name = upPullTargets)]
pub fn up_pull_targets(descendants: JsValue) -> Answer {
    let descendants = from_js::<Vec<String>>(descendants)?;
    let (targets, truncated) = propagation::up_pull_targets(&descendants);
    to_js(&UpPull {
        targets: targets.to_vec(),
        truncated,
    })
}

/// What a descendant holds of `event`, by the allow-list; refused for a private event.
#[wasm_bindgen]
pub fn project(event: JsValue) -> Answer {
    to_js(&propagation::project(&from_js::<Event>(event)?).map_err(refused)?)
}

/// How far a fan-out writes and an up-pull reads.
#[wasm_bindgen(js_name = propagationBounds)]
pub fn propagation_bounds() -> Answer {
    to_js(&PropagationBounds::of_core())
}

/// What a reader does with a projection, given what it can read of its origin.
#[wasm_bindgen]
pub fn reconcile(projection: JsValue, origin: JsValue) -> Answer {
    let projection = from_js::<Projection>(projection)?;
    let origin = from_js::<OriginRead>(origin)?;
    let read = match &origin {
        OriginRead::Unreadable => None,
        OriginRead::Gone => Some(None),
        OriginRead::Found { event } => Some(Some(event.as_ref())),
    };
    to_js(&propagation::reconcile(&projection, read))
}

#[wasm_bindgen(js_name = exportIcs)]
pub fn export_ics(events: JsValue) -> Answer {
    let (text, unwritten) = ics_export::export(&from_js::<Vec<Event>>(events)?);
    to_js(&IcsFile { text, unwritten })
}

/// An event's stored bytes: versioned CBOR, refused past `EVENT_MAX_BYTES`.
#[wasm_bindgen(js_name = encodeEvent)]
pub fn encode_event(event: JsValue) -> Result<Vec<u8>, JsValue> {
    codec::event_to_bytes(&from_js::<Event>(event)?).map_err(refused)
}

#[wasm_bindgen(js_name = decodeEvent)]
pub fn decode_event(bytes: &[u8]) -> Answer {
    to_js(&codec::from_bytes::<Event>(bytes).map_err(refused)?)
}

macro_rules! stored {
    ($($t:ty: $encode:ident = $js_encode:literal, $decode:ident = $js_decode:literal;)*) => {$(
        #[wasm_bindgen(js_name = $js_encode)]
        pub fn $encode(value: JsValue) -> Result<Vec<u8>, JsValue> {
            Ok(codec::to_bytes(&from_js::<$t>(value)?))
        }

        #[wasm_bindgen(js_name = $js_decode)]
        pub fn $decode(bytes: &[u8]) -> Answer {
            to_js(&codec::from_bytes::<$t>(bytes).map_err(refused)?)
        }
    )*};
}

stored! {
    Availability: encode_availability = "encodeAvailability", decode_availability = "decodeAvailability";
    EventType: encode_event_type = "encodeEventType", decode_event_type = "decodeEventType";
    Booking: encode_booking = "encodeBooking", decode_booking = "decodeBooking";
    Projection: encode_projection = "encodeProjection", decode_projection = "decodeProjection";
    RoutingForm: encode_routing_form = "encodeRoutingForm", decode_routing_form = "decodeRoutingForm";
    Poll: encode_poll = "encodePoll", decode_poll = "decodePoll";
    PollVote: encode_poll_vote = "encodePollVote", decode_poll_vote = "decodePollVote";
    ReminderPlan: encode_reminder_plan = "encodeReminderPlan", decode_reminder_plan = "decodeReminderPlan";
}

/// A `cal` topic message: `{ node, key }` and nothing else.
#[wasm_bindgen(js_name = encodeChange)]
pub fn encode_change(change: JsValue) -> Result<Vec<u8>, JsValue> {
    topic::encode_change(&from_js(change)?).map_err(refused)
}

#[wasm_bindgen(js_name = decodeChange)]
pub fn decode_change(bytes: &[u8]) -> Answer {
    to_js(&topic::decode_change(bytes).map_err(refused)?)
}
