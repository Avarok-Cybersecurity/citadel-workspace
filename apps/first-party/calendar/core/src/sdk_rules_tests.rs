//! `sdk_rules` and `sdk_views`: an app changes only the events it added and only at their current
//! revision; what an app adds is the member's own, never pushed down, and bounded by the per-app
//! limit; what it reads carries no body and nothing cancelled.

use crate::codec_tests::event;
use crate::model::{Location, Propagate, Source, Visibility, When};
use crate::sdk::{EventPatch, Include, NewEvent, SdkCode};
use crate::sdk_rules::*;
use crate::sdk_views::{projection_view, view_of};
use crate::tz::Zone;
use std::vec;
use std::vec::Vec;

fn new_req() -> NewEvent {
    NewEvent {
        node: "n1".into(),
        title: "  Sprint review ".into(),
        when: When::Once {
            start_ms: 1_000,
            end_ms: 2_000,
        },
        zone: Zone::new("America/New_York").expect("a zone"),
        location: Location::InApp,
        visibility: Visibility::Public,
        propagate: Propagate {
            down: false,
            up_to: None,
        },
        reminders: vec![
            crate::model::ReminderOffset { minutes_before: 10 },
            crate::model::ReminderOffset { minutes_before: 5 },
            crate::model::ReminderOffset { minutes_before: 10 },
        ],
        reference: "card-7".into(),
    }
}

fn adding(kept: u32) -> Adding {
    Adding {
        id: "e9".into(),
        me: "amy".into(),
        app_id: "com.acme.kanban".into(),
        kept,
        now_ms: 50,
    }
}

#[test]
fn an_added_event_is_the_members_own_and_names_its_app() {
    let (e, placement) = new_event(&new_req(), &adding(0)).expect("added");
    assert_eq!(placement, Placement::Authored { node: "n1".into() });
    assert_eq!(
        (e.title.as_str(), e.author.as_str(), e.rev, e.created_ms),
        ("Sprint review", "amy", 1, 50)
    );
    assert_eq!(
        e.source,
        Some(Source {
            app_id: "com.acme.kanban".into(),
            reference: "card-7".into()
        })
    );
    assert_eq!(
        e.reminders
            .iter()
            .map(|r| r.minutes_before)
            .collect::<Vec<_>>(),
        [5, 10]
    );
    let private = NewEvent {
        visibility: Visibility::Private,
        ..new_req()
    };
    assert_eq!(
        new_event(&private, &adding(0)).expect("added").1,
        Placement::Private
    );
}

#[test]
fn what_an_app_may_not_add_is_refused() {
    let code = |req: NewEvent, kept: u32| {
        new_event(&req, &adding(kept))
            .map(|_| ())
            .map_err(|r| r.code)
    };
    assert_eq!(code(new_req(), 499), Ok(()));
    assert_eq!(code(new_req(), 500), Err(SdkCode::Limit));
    assert_eq!(
        code(
            NewEvent {
                propagate: Propagate {
                    down: true,
                    up_to: None
                },
                ..new_req()
            },
            0
        ),
        Err(SdkCode::Invalid)
    );
    assert_eq!(
        code(
            NewEvent {
                visibility: Visibility::Private,
                propagate: Propagate {
                    down: false,
                    up_to: Some("root".into())
                },
                ..new_req()
            },
            0
        ),
        Err(SdkCode::Invalid)
    );
    assert_eq!(
        code(
            NewEvent {
                title: "   ".into(),
                ..new_req()
            },
            0
        ),
        Err(SdkCode::Invalid)
    );
    assert_eq!(
        code(
            NewEvent {
                when: When::Once {
                    start_ms: 5,
                    end_ms: 5
                },
                ..new_req()
            },
            0
        ),
        Err(SdkCode::Invalid)
    );
    assert_eq!(
        code(
            NewEvent {
                reference: "".into(),
                ..new_req()
            },
            0
        ),
        Err(SdkCode::Invalid)
    );
}

fn apps_event(app: &str, rev: u32) -> crate::model::Event {
    let mut e = event("e1");
    e.rev = rev;
    e.source = Some(Source {
        app_id: app.into(),
        reference: "r".into(),
    });
    e
}

fn patch(rev: u32) -> EventPatch {
    EventPatch {
        rev,
        title: Some("Renamed".into()),
        when: None,
        zone: None,
        location: None,
        reminders: None,
    }
}

#[test]
fn an_app_changes_only_its_own_events_at_their_current_revision() {
    let mine = apps_event("com.acme.kanban", 3);
    let next = patched(&mine, &patch(3), "com.acme.kanban", 77).expect("patched");
    assert_eq!(
        (next.title.as_str(), next.rev, next.updated_ms),
        ("Renamed", 4, 77)
    );
    let stale = patched(&mine, &patch(2), "com.acme.kanban", 77).expect_err("stale");
    assert_eq!((stale.code, stale.current_rev), (SdkCode::Stale, Some(3)));
    assert_eq!(
        patched(
            &apps_event("com.other", 3),
            &patch(3),
            "com.acme.kanban",
            77
        )
        .map_err(|r| r.code),
        Err(SdkCode::NotYours)
    );
    assert_eq!(
        may_change(&event("e1"), "com.acme.kanban", 1).map_err(|r| r.code),
        Err(SdkCode::NotYours),
        "the member's own event"
    );
}

#[test]
fn a_view_carries_no_body_and_no_cancelled_event() {
    let mut e = apps_event("com.acme.kanban", 1);
    e.body = Some("secret".into());
    let view = view_of(&e, Include::Own).expect("shown");
    assert_eq!((view.id.as_str(), view.include), ("e1", Include::Own));
    assert_eq!(view.title.as_deref(), Some("Design review"));
    e.status = crate::model::EventStatus::Cancelled {
        by: "amy".into(),
        reason: None,
    };
    assert_eq!(view_of(&e, Include::Own), None);
}

#[test]
fn an_ancestors_busy_only_event_is_read_without_a_title_or_a_place() {
    let mut e = event("e1");
    e.visibility = Visibility::BusyOnly;
    let projection = crate::propagation::project(&e).expect("projected");
    let view = projection_view("e1", &projection);
    assert_eq!(
        (view.title, view.location, view.visibility, view.include),
        (None, None, Visibility::BusyOnly, Include::Inherited)
    );
}
