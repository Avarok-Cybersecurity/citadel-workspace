//! The crate's calls against the Calendar's side of the wire: each request is parsed and decided
//! by calendar-core exactly as the Calendar's instance does (route, query, body, gate, rules) and
//! the answer is read back here. A refusal crosses as its own variant, a wrong-status or foreign
//! body is `Unexpected`, never a value.

use crate::wire::*;
use crate::wire_fake::Calendar;
use calendar_core::codec::to_bytes;
use calendar_core::model::{Location, Propagate, Visibility, When};
use calendar_core::sdk::{
    EventPatch, EventRef, Events, Health, Include, ListQuery, NewEvent, Rev, SdkCode, SdkRefusal,
};
use calendar_core::sdk_rules::Consent;
use calendar_core::tz::Zone;
use citadel_app_sdk_types::Refused;
use std::collections::BTreeMap;

fn standup() -> NewEvent {
    NewEvent {
        node: "n1".into(),
        title: "Standup".into(),
        when: When::Once {
            start_ms: 1_000,
            end_ms: 2_000,
        },
        zone: Zone::new("Europe/Berlin").expect("a zone"),
        location: Location::InApp,
        visibility: Visibility::Public,
        propagate: Propagate {
            down: false,
            up_to: None,
        },
        reminders: Vec::new(),
        reference: "card-1".into(),
    }
}

fn calendar(consent: Option<Consent>) -> Calendar {
    Calendar {
        me: "amy",
        consent,
        events: BTreeMap::new(),
    }
}

const KANBAN: &str = "com.acme.kanban";

#[test]
fn an_app_adds_reads_changes_and_removes_its_event() {
    let mut cal = calendar(Some(Consent::Allow));
    let added: EventRef =
        answer(cal.serve("amy", KANBAN, &add_event(&standup())), ADDED).expect("added");
    let listed: Events = answer(
        cal.serve(
            "amy",
            KANBAN,
            &list(&ListQuery {
                node: "n1".into(),
                from_ms: 0,
                to_ms: 5_000,
                include: Include::Own,
            }),
        ),
        OK,
    )
    .expect("listed");
    assert_eq!(
        listed
            .events
            .iter()
            .map(|e| (e.id.as_str(), e.title.as_deref()))
            .collect::<Vec<_>>(),
        [("e1", Some("Standup"))]
    );
    let patch = EventPatch {
        rev: added.rev,
        title: Some("Daily".into()),
        when: None,
        zone: None,
        location: None,
        reminders: None,
    };
    let rev: Rev = answer(
        cal.serve("amy", KANBAN, &update_event(&added.id, &patch)),
        OK,
    )
    .expect("updated");
    assert_eq!(rev.rev, 2);
    assert_eq!(
        answer_empty(cal.serve("amy", KANBAN, &remove_event(&added.id, 2))),
        Ok(())
    );
    assert!(cal.events.is_empty());
    let health: Health = answer(cal.serve("bob", KANBAN, &health()), OK).expect("healthy");
    assert_eq!(health.wire, 1);
}

#[test]
fn each_refusal_crosses_as_its_own_variant() {
    let mut cal = calendar(Some(Consent::Allow));
    let added: EventRef =
        answer(cal.serve("amy", KANBAN, &add_event(&standup())), ADDED).expect("added");
    let stale = EventPatch {
        rev: 7,
        title: None,
        when: None,
        zone: None,
        location: None,
        reminders: None,
    };
    assert_eq!(
        answer::<Rev>(
            cal.serve("amy", KANBAN, &update_event(&added.id, &stale)),
            OK
        ),
        Err(CalendarRefusal::Stale { current_rev: 1 })
    );
    assert_eq!(
        answer_empty(cal.serve("amy", "com.other", &remove_event(&added.id, 1))),
        Err(CalendarRefusal::NotYours)
    );
    assert_eq!(
        answer::<EventRef>(cal.serve("bob", KANBAN, &add_event(&standup())), ADDED),
        Err(CalendarRefusal::CrossUser)
    );
    let down = NewEvent {
        propagate: Propagate {
            down: true,
            up_to: None,
        },
        ..standup()
    };
    assert!(matches!(
        answer::<EventRef>(cal.serve("amy", KANBAN, &add_event(&down)), ADDED),
        Err(CalendarRefusal::Invalid(_))
    ));
    let mut refusing = calendar(Some(Consent::Refuse));
    assert_eq!(
        answer::<EventRef>(refusing.serve("amy", KANBAN, &add_event(&standup())), ADDED),
        Err(CalendarRefusal::NotConsented)
    );
}

#[test]
fn an_answer_that_is_not_the_wire_is_unexpected_and_a_transport_failure_says_why() {
    assert_eq!(
        answer::<EventRef>(Ok((201, std::vec![1, 2, 3])), ADDED),
        Err(CalendarRefusal::Unexpected { status: 201 })
    );
    let mismatched = to_bytes(&SdkRefusal::new(SdkCode::Limit, "x"));
    assert_eq!(
        answer::<EventRef>(Ok((403, mismatched)), ADDED),
        Err(CalendarRefusal::Unexpected { status: 403 })
    );
    assert_eq!(
        answer_empty(Ok((204, std::vec![0]))),
        Err(CalendarRefusal::Unexpected { status: 204 })
    );
    assert_eq!(
        answer::<EventRef>(Err(Refused::Ungranted), ADDED),
        Err(CalendarRefusal::Ungranted)
    );
    assert_eq!(
        answer::<EventRef>(Err(Refused::Unavailable("offline".into())), ADDED),
        Err(CalendarRefusal::Unavailable(Refused::Unavailable(
            "offline".into()
        )))
    );
}
