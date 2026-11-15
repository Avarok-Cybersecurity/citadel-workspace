//! The calls, over the app SDK's internal HTTP (wasm32 only): each builds its request with `wire`,
//! sends it to the Calendar in the member's own session, and hands `wire`'s reading of the answer
//! to the app's callback. Dropping the returned handle lets the call run; `cancel` gives it up.

use crate::wire::{self, CalendarRefusal, CalendarRequest, CALENDAR_APP_ID};
use calendar_core::sdk::{
    EventPatch, EventRef, Events, FreeBusy, FreeBusyQuery, Health, ListQuery, NewEvent, Rev,
};
use citadel_app_sdk::ihttp::{Address, CallHandle, Client, Outbound, Response, Transport};
use citadel_app_sdk::{AppContext, Refused};

pub struct Calendar {
    client: Client,
}

type Answered = Result<(u16, Vec<u8>), Refused>;

fn outbound(r: CalendarRequest) -> Outbound {
    Outbound {
        method: r.method,
        path: r.path,
        query: r.query,
        headers: Vec::new(),
        body: r.body,
    }
}

fn whole(r: Result<Response, Refused>) -> Answered {
    r.map(|r| (r.head.status, r.body))
}

impl Calendar {
    /// The Calendar of the member this app runs for. The call travels the server's relay: the
    /// member's own Calendar is reached in their session, never peer to peer.
    pub fn new(ctx: &AppContext) -> Calendar {
        let to = Address::User {
            app_id: CALENDAR_APP_ID.into(),
            username: ctx.acting_username.clone(),
        };
        Calendar {
            client: Client::new(to, Transport::Relay),
        }
    }

    fn send<A: 'static>(
        &self,
        r: CalendarRequest,
        f: impl FnOnce(&mut A, Answered) + 'static,
    ) -> CallHandle {
        self.client.call(outbound(r), move |app: &mut A, response| {
            f(app, whole(response))
        })
    }

    pub fn add_event<A: 'static>(
        &self,
        event: &NewEvent,
        f: impl FnOnce(&mut A, Result<EventRef, CalendarRefusal>) + 'static,
    ) -> CallHandle {
        self.send(wire::add_event(event), move |app, a| {
            f(app, wire::answer(a, wire::ADDED))
        })
    }

    /// The new revision.
    pub fn update_event<A: 'static>(
        &self,
        id: &str,
        patch: &EventPatch,
        f: impl FnOnce(&mut A, Result<u32, CalendarRefusal>) + 'static,
    ) -> CallHandle {
        self.send(wire::update_event(id, patch), move |app, a| {
            f(app, wire::answer::<Rev>(a, wire::OK).map(|r| r.rev))
        })
    }

    pub fn remove_event<A: 'static>(
        &self,
        id: &str,
        rev: u32,
        f: impl FnOnce(&mut A, Result<(), CalendarRefusal>) + 'static,
    ) -> CallHandle {
        self.send(wire::remove_event(id, rev), move |app, a| {
            f(app, wire::answer_empty(a))
        })
    }

    pub fn list<A: 'static>(
        &self,
        query: &ListQuery,
        f: impl FnOnce(&mut A, Result<Events, CalendarRefusal>) + 'static,
    ) -> CallHandle {
        self.send(wire::list(query), move |app, a| {
            f(app, wire::answer(a, wire::OK))
        })
    }

    pub fn free_busy<A: 'static>(
        &self,
        query: &FreeBusyQuery,
        f: impl FnOnce(&mut A, Result<FreeBusy, CalendarRefusal>) + 'static,
    ) -> CallHandle {
        self.send(wire::free_busy(query), move |app, a| {
            f(app, wire::answer(a, wire::OK))
        })
    }

    /// The probe: whether a Calendar answers, and which wire it speaks.
    pub fn health<A: 'static>(
        &self,
        f: impl FnOnce(&mut A, Result<Health, CalendarRefusal>) + 'static,
    ) -> CallHandle {
        self.send(wire::health(), move |app, a| {
            f(app, wire::answer(a, wire::OK))
        })
    }
}
