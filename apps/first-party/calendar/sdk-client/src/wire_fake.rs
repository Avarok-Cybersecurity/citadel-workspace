//! TEST FAKE: the Calendar's side of the SDK wire, deciding each request with calendar-core
//! exactly as the Calendar's instance does (route, query, body, gate, rules), over one member's
//! events held in memory. Free/busy is not served here.

use crate::wire::CalendarRequest;
use calendar_core::codec::{from_bytes, to_bytes};
use calendar_core::model::Event;
use calendar_core::sdk::{
    sdk_route, EventPatch, EventRef, Events, NewEvent, Rev, SdkCode, SdkRefusal, SdkRoute,
};
use calendar_core::sdk_query::parse_list_query;
use calendar_core::sdk_rules::{gate, may_change, new_event, patched, Adding, Consent, Gate};
use calendar_core::sdk_views::view_of;
use citadel_app_sdk_types::Refused;
use std::collections::BTreeMap;

/// The Calendar's decisions over one member's events, as its instance makes them.
pub(crate) struct Calendar {
    pub(crate) me: &'static str,
    pub(crate) consent: Option<Consent>,
    pub(crate) events: BTreeMap<String, Event>,
}

fn refused(r: SdkRefusal) -> (u16, Vec<u8>) {
    (r.code.status(), to_bytes(&r))
}

impl Calendar {
    pub(crate) fn serve(
        &mut self,
        caller: &str,
        app: &str,
        r: &CalendarRequest,
    ) -> Result<(u16, Vec<u8>), Refused> {
        let Some(route) = sdk_route(&r.method, &r.path) else {
            return Ok((404, Vec::new()));
        };
        match gate(&route, caller, self.me, self.consent) {
            Gate::Proceed => {}
            Gate::Ask => {
                return Ok(refused(SdkRefusal::new(
                    SdkCode::NotConsented,
                    "not asked in this test",
                )))
            }
            Gate::Refuse(why) => return Ok(refused(why)),
        }
        Ok(match route {
            SdkRoute::Health => (200, to_bytes(&calendar_core::sdk_rules::health())),
            SdkRoute::Create => {
                let req: NewEvent = from_bytes(&r.body).expect("a NewEvent");
                let id = std::format!("e{}", self.events.len() + 1);
                match new_event(
                    &req,
                    &Adding {
                        id: id.clone(),
                        me: self.me.into(),
                        app_id: app.into(),
                        kept: self.events.len() as u32,
                        now_ms: 9,
                    },
                ) {
                    Ok((event, _)) => {
                        self.events.insert(id.clone(), event);
                        (201, to_bytes(&EventRef { id, rev: 1 }))
                    }
                    Err(why) => refused(why),
                }
            }
            SdkRoute::Patch { id } => {
                let patch: EventPatch = from_bytes(&r.body).expect("a patch");
                match patched(&self.events[&id], &patch, app, 10) {
                    Ok(next) => {
                        let rev = next.rev;
                        self.events.insert(id, next);
                        (200, to_bytes(&Rev { rev }))
                    }
                    Err(why) => refused(why),
                }
            }
            SdkRoute::Delete { id } => {
                let Rev { rev } = from_bytes(&r.body).expect("a rev");
                match may_change(&self.events[&id], app, rev) {
                    Ok(()) => {
                        self.events.remove(&id);
                        (204, Vec::new())
                    }
                    Err(why) => refused(why),
                }
            }
            SdkRoute::List => {
                let q = parse_list_query(&r.query).expect("a list query");
                let events = self
                    .events
                    .values()
                    .filter(|e| e.origin_node == q.node)
                    .filter_map(|e| view_of(e, q.include))
                    .collect();
                (200, to_bytes(&Events { events }))
            }
            SdkRoute::FreeBusy => unreachable!("not called here"),
        })
    }
}
