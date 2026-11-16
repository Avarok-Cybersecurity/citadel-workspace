//! Each call as a request, and each answer as a result: calendar-core's SDK wire, which the
//! Calendar's instance parses and answers with, so a request built here is one it understands.
//! Pure, and so tested natively; `calls` (wasm32) sends these over the app SDK's internal HTTP.

use calendar_core::codec::{from_bytes, to_bytes};
use calendar_core::sdk::{
    self, EventPatch, EventRef, Events, FreeBusy, FreeBusyQuery, Health, ListQuery, NewEvent, Rev,
    SdkCode, SdkRefusal, EVENTS_PATH, FREE_BUSY_PATH, HEALTH_PATH,
};
use calendar_core::sdk_query::{free_busy_query_string, list_query_string};
use citadel_app_sdk_types::calls::HttpMethod;
use citadel_app_sdk_types::Refused;
use serde::de::DeserializeOwned;

/// The Calendar's app id: the address every call names.
pub const CALENDAR_APP_ID: &str = "net.avarok.calendar";

/// One request to the Calendar: what `ihttp::Outbound` carries.
#[derive(Clone, Debug, PartialEq)]
pub struct CalendarRequest {
    pub method: HttpMethod,
    pub path: String,
    pub query: String,
    pub body: Vec<u8>,
}

/// Why a call did not do what it asked.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CalendarRefusal {
    /// This app's manifest or installer does not let it call the Calendar.
    Ungranted,
    /// The member refused this app, or has not answered.
    NotConsented,
    /// The call reached another member's Calendar; only `/book` crosses members.
    CrossUser,
    /// The event was added by another app, or by the member.
    NotYours,
    /// The event moved on; `current_rev` is where it is now.
    Stale {
        current_rev: u32,
    },
    NotFound,
    Invalid(String),
    Limit(String),
    /// The Calendar could not read the request: a bug on this side of the wire.
    BadRequest(String),
    /// The call did not reach a Calendar that answered it.
    Unavailable(Refused),
    /// An answer that is not the wire's.
    Unexpected {
        status: u16,
    },
}

fn request(method: HttpMethod, path: String, query: String, body: Vec<u8>) -> CalendarRequest {
    CalendarRequest {
        method,
        path,
        query,
        body,
    }
}

pub fn add_event(event: &NewEvent) -> CalendarRequest {
    request(
        HttpMethod::Post,
        EVENTS_PATH.into(),
        String::new(),
        to_bytes(event),
    )
}

pub fn update_event(id: &str, patch: &EventPatch) -> CalendarRequest {
    request(
        HttpMethod::Patch,
        sdk::event_path(id),
        String::new(),
        to_bytes(patch),
    )
}

pub fn remove_event(id: &str, rev: u32) -> CalendarRequest {
    request(
        HttpMethod::Delete,
        sdk::event_path(id),
        String::new(),
        to_bytes(&Rev { rev }),
    )
}

pub fn list(query: &ListQuery) -> CalendarRequest {
    request(
        HttpMethod::Get,
        EVENTS_PATH.into(),
        list_query_string(query),
        Vec::new(),
    )
}

pub fn free_busy(query: &FreeBusyQuery) -> CalendarRequest {
    request(
        HttpMethod::Get,
        FREE_BUSY_PATH.into(),
        free_busy_query_string(query),
        Vec::new(),
    )
}

pub fn health() -> CalendarRequest {
    request(
        HttpMethod::Get,
        HEALTH_PATH.into(),
        String::new(),
        Vec::new(),
    )
}

fn refusal_of(status: u16, body: &[u8]) -> CalendarRefusal {
    let Ok(r) = from_bytes::<SdkRefusal>(body) else {
        return CalendarRefusal::Unexpected { status };
    };
    if r.code.status() != status {
        return CalendarRefusal::Unexpected { status };
    }
    let detail = r.detail.unwrap_or_default();
    match r.code {
        SdkCode::CrossUser => CalendarRefusal::CrossUser,
        SdkCode::NotConsented => CalendarRefusal::NotConsented,
        SdkCode::NotYours => CalendarRefusal::NotYours,
        SdkCode::Stale => r
            .current_rev
            .map_or(CalendarRefusal::Unexpected { status }, |current_rev| {
                CalendarRefusal::Stale { current_rev }
            }),
        SdkCode::NotFound => CalendarRefusal::NotFound,
        SdkCode::Invalid => CalendarRefusal::Invalid(detail),
        SdkCode::Limit => CalendarRefusal::Limit(detail),
        SdkCode::BadRequest => CalendarRefusal::BadRequest(detail),
    }
}

/// The answer to a call that expects `ok` and a `T` body: the value, or why not.
pub fn answer<T: DeserializeOwned>(
    response: Result<(u16, Vec<u8>), Refused>,
    ok: u16,
) -> Result<T, CalendarRefusal> {
    let (status, body) = response.map_err(|e| {
        if e == Refused::Ungranted {
            CalendarRefusal::Ungranted
        } else {
            CalendarRefusal::Unavailable(e)
        }
    })?;
    if status != ok {
        return Err(refusal_of(status, &body));
    }
    from_bytes::<T>(&body).map_err(|_| CalendarRefusal::Unexpected { status })
}

/// `DELETE`'s answer: 204 and no body.
pub fn answer_empty(response: Result<(u16, Vec<u8>), Refused>) -> Result<(), CalendarRefusal> {
    let (status, body) = response.map_err(|e| {
        if e == Refused::Ungranted {
            CalendarRefusal::Ungranted
        } else {
            CalendarRefusal::Unavailable(e)
        }
    })?;
    if status == 204 && body.is_empty() {
        return Ok(());
    }
    Err(if status == 204 {
        CalendarRefusal::Unexpected { status }
    } else {
        refusal_of(status, &body)
    })
}

/// The status each successful answer has.
pub const ADDED: u16 = 201;
pub const OK: u16 = 200;

/// The types each call answers with, named for the calls.
pub type Added = EventRef;
pub type Updated = Rev;
pub type Listed = Events;
pub type Busy = FreeBusy;
pub type Healthy = Health;
