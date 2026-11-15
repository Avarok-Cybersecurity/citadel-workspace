//! The core's team booking, poll and routing-form decisions for the page (Calendar design §3.6.2,
//! §3.6.3): functions of their arguments only, as everything the glue exports is.

use crate::values::{from_js, refused, to_js};
use calendar_core::model::Username;
use calendar_core::model_booking::Answer;
use calendar_core::poll::{self, Poll, PollVote};
use calendar_core::routing::{self, RoutingForm};
use calendar_core::team::{self, HostAnswer};
use wasm_bindgen::prelude::*;

type Answered = Result<JsValue, JsValue>;

/// Where `answers` route on `form`: the first rule that holds, else its fallback.
#[wasm_bindgen]
pub fn route(form: JsValue, answers: JsValue) -> Answered {
    let (form, answers) = (
        from_js::<RoutingForm>(form)?,
        from_js::<Vec<Answer>>(answers)?,
    );
    to_js(routing::route(&form, &answers).map_err(refused)?)
}

#[wasm_bindgen(js_name = checkRoutingForm)]
pub fn check_routing_form(form: JsValue) -> Result<(), JsValue> {
    routing::check_form(&from_js::<RoutingForm>(form)?).map_err(refused)
}

#[wasm_bindgen(js_name = checkPoll)]
pub fn check_poll(poll: JsValue) -> Result<(), JsValue> {
    poll::check_poll(&from_js::<Poll>(poll)?).map_err(refused)
}

#[wasm_bindgen(js_name = checkVote)]
pub fn check_vote(poll: JsValue, vote: JsValue) -> Result<(), JsValue> {
    poll::check_vote(&from_js::<Poll>(poll)?, &from_js::<PollVote>(vote)?).map_err(refused)
}

/// `votes`: `[voter, vote][]`. Each proposal with who said yes and maybe.
#[wasm_bindgen(js_name = tallyPoll)]
pub fn tally_poll(poll: JsValue, votes: JsValue) -> Answered {
    let (poll, votes) = (
        from_js::<Poll>(poll)?,
        from_js::<Vec<(Username, PollVote)>>(votes)?,
    );
    let tallies = poll::tally(&poll, &votes);
    to_js(&(poll::leading(&tallies), tallies))
}

/// `[picked poll, the slot it picked]`.
#[wasm_bindgen(js_name = pickPoll)]
pub fn pick_poll(poll: JsValue, proposal: u16, event_id: String) -> Answered {
    to_js(&poll::pick(&from_js::<Poll>(poll)?, proposal, event_id).map_err(refused)?)
}

#[wasm_bindgen(js_name = seatsLeft)]
pub fn seats_left(seats: u16, taken: u32) -> u16 {
    team::seats_left(seats, taken as usize)
}

/// `answers`: `[host, HostAnswer][]` in the order the hosts were asked.
#[wasm_bindgen(js_name = collectiveOutcome)]
pub fn collective_outcome(answers: JsValue) -> Answered {
    let answers = from_js::<Vec<(Username, HostAnswer)>>(answers)?;
    to_js(&team::collective_outcome(&answers).map_err(refused)?)
}
