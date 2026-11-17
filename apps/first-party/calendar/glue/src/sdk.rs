//! The Calendar SDK's wire and decisions for the page (Calendar design §3.8): the Calendar's
//! instance reads requests and answers with these, and the page's TypeScript mirror builds
//! requests and reads answers with them, so both use the core's one definition. A decision an
//! app's request gets is an `SdkAnswer`, `{ ok } | { refused }`: a refusal there is an answer to
//! send, not a fault, so it is returned, never thrown.

use crate::values::{from_js, to_js};
use calendar_core::model::Event;
use calendar_core::propagation::Projection;
use calendar_core::sdk::{
    self, EventPatch, EventRef, Events, FreeBusy, FreeBusyQuery, Health, Include, ListQuery,
    NewEvent, Rev, SdkCode, SdkRefusal, SdkRoute,
};
use calendar_core::sdk_query;
use calendar_core::sdk_rules::{self, Adding, Consent, Placement, SdkAnswer};
use calendar_core::sdk_views;
use citadel_app_sdk_types::calls::HttpMethod;
use wasm_bindgen::prelude::*;

type Answered = Result<JsValue, JsValue>;

#[wasm_bindgen(js_name = sdkRoutes)]
pub fn sdk_routes() -> Answered {
    to_js(&sdk::sdk_routes())
}

/// The SDK route a request names, or null.
#[wasm_bindgen(js_name = sdkRoute)]
pub fn sdk_route(method: JsValue, path: String) -> Answered {
    to_js(&sdk::sdk_route(&from_js::<HttpMethod>(method)?, &path))
}

#[wasm_bindgen(js_name = sdkStatus)]
pub fn status(code: JsValue) -> Result<u16, JsValue> {
    Ok(from_js::<SdkCode>(code)?.status())
}

#[wasm_bindgen(js_name = sdkHealth)]
pub fn health() -> Answered {
    to_js(&sdk_rules::health())
}

#[wasm_bindgen(js_name = eventPath)]
pub fn event_path(id: String) -> String {
    sdk::event_path(&id)
}

#[wasm_bindgen(js_name = listQueryString)]
pub fn list_query_string(query: JsValue) -> Result<String, JsValue> {
    Ok(sdk_query::list_query_string(&from_js::<ListQuery>(query)?))
}

#[wasm_bindgen(js_name = parseListQuery)]
pub fn parse_list_query(query: String) -> Answered {
    to_js(&SdkAnswer::from(sdk_query::parse_list_query(&query)))
}

#[wasm_bindgen(js_name = freeBusyQueryString)]
pub fn free_busy_query_string(query: JsValue) -> Result<String, JsValue> {
    Ok(sdk_query::free_busy_query_string(
        &from_js::<FreeBusyQuery>(query)?,
    ))
}

#[wasm_bindgen(js_name = parseFreeBusyQuery)]
pub fn parse_free_busy_query(query: String) -> Answered {
    to_js(&SdkAnswer::from(sdk_query::parse_free_busy_query(&query)))
}

/// `consent`: the member's stored answer for the calling app, or null.
#[wasm_bindgen(js_name = sdkGate)]
pub fn gate(route: JsValue, caller: String, acting: String, consent: JsValue) -> Answered {
    let (route, consent) = (
        from_js::<SdkRoute>(route)?,
        from_js::<Option<Consent>>(consent)?,
    );
    to_js(&sdk_rules::gate(&route, &caller, &acting, consent))
}

/// The instants to keep, this one included, or null when it does not fit.
#[wasm_bindgen(js_name = sdkRateAdmit)]
pub fn rate_admit(recent_ms: JsValue, now_ms: u64) -> Answered {
    to_js(&sdk_rules::rate_admit(
        &from_js::<Vec<u64>>(recent_ms)?,
        now_ms,
    ))
}

/// `[event, placement]`, or the refusal.
#[wasm_bindgen(js_name = newSdkEvent)]
pub fn new_event(request: JsValue, adding: JsValue) -> Answered {
    let (request, adding) = (from_js::<NewEvent>(request)?, from_js::<Adding>(adding)?);
    to_js(&SdkAnswer::from(sdk_rules::new_event(&request, &adding)))
}

#[wasm_bindgen(js_name = patchSdkEvent)]
pub fn patch_event(event: JsValue, patch: JsValue, app_id: String, now_ms: u64) -> Answered {
    let (event, patch) = (from_js::<Event>(event)?, from_js::<EventPatch>(patch)?);
    to_js(&SdkAnswer::from(sdk_rules::patched(
        &event, &patch, &app_id, now_ms,
    )))
}

#[wasm_bindgen(js_name = mayChangeSdkEvent)]
pub fn may_change(event: JsValue, app_id: String, rev: u32) -> Answered {
    to_js(&SdkAnswer::from(sdk_rules::may_change(
        &from_js::<Event>(event)?,
        &app_id,
        rev,
    )))
}

/// The app's view of an event, or null for one it is not shown.
#[wasm_bindgen(js_name = sdkView)]
pub fn view(event: JsValue, include: JsValue) -> Answered {
    to_js(&sdk_views::view_of(
        &from_js::<Event>(event)?,
        from_js::<Include>(include)?,
    ))
}

/// An ancestor's event as the page's projection of it holds it.
#[wasm_bindgen(js_name = sdkProjectionView)]
pub fn projection_view(event_id: String, projection: JsValue) -> Answered {
    to_js(&sdk_views::projection_view(
        &event_id,
        &from_js::<Projection>(projection)?,
    ))
}

stored! {
    NewEvent: encode_new_event = "encodeNewEvent", decode_new_event = "decodeNewEvent";
    EventPatch: encode_event_patch = "encodeEventPatch", decode_event_patch = "decodeEventPatch";
    Rev: encode_rev = "encodeRev", decode_rev = "decodeRev";
    EventRef: encode_event_ref = "encodeEventRef", decode_event_ref = "decodeEventRef";
    Events: encode_events = "encodeEvents", decode_events = "decodeEvents";
    FreeBusy: encode_free_busy = "encodeFreeBusy", decode_free_busy = "decodeFreeBusy";
    Health: encode_health = "encodeHealth", decode_health = "decodeHealth";
    SdkRefusal: encode_sdk_refusal = "encodeSdkRefusal", decode_sdk_refusal = "decodeSdkRefusal";
    Consent: encode_consent = "encodeConsent", decode_consent = "decodeConsent";
    Placement: encode_placement = "encodePlacement", decode_placement = "decodePlacement";
}
