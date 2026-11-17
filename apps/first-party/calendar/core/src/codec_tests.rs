//! `codec`: values round-trip under `v: 1`, a newer version is refused as such (never read as
//! this one), garbage is malformed, and an event past 8 KiB is refused.

use crate::codec::*;
use crate::model::*;
use crate::test_tz::zone;
use std::string::String;
use std::vec;

pub(crate) fn event(id: &str) -> Event {
    Event {
        id: id.into(),
        rev: 1,
        origin_node: "eng".into(),
        author: "ana".into(),
        title: "Design review".into(),
        body: Some("Agenda".into()),
        kind: EventKind::Plain,
        status: EventStatus::Confirmed,
        when: When::Once {
            start_ms: 1_000,
            end_ms: 2_000,
        },
        zone: zone("America/New_York"),
        location: Location::InApp,
        hosts: vec!["ana".into()],
        invitees: vec![Invitee::Member {
            username: "lee".into(),
        }],
        visibility: Visibility::Public,
        propagate: Propagate {
            down: false,
            up_to: None,
        },
        reminders: vec![ReminderOffset { minutes_before: 10 }],
        notes_doc: None,
        source: None,
        created_ms: 1,
        updated_ms: 1,
    }
}

#[test]
fn an_event_round_trips() {
    let e = event("e1");
    let bytes = event_to_bytes(&e).expect("fits");
    assert_eq!(from_bytes::<Event>(&bytes), Ok(e));
}

#[test]
fn a_newer_version_is_refused_as_unknown_not_read() {
    #[derive(serde::Serialize)]
    struct Future {
        v: u8,
        value: u8,
    }
    let bytes = citadel_app_sdk_types::encode(&Future { v: 2, value: 0 });
    assert_eq!(
        from_bytes::<Event>(&bytes),
        Err(CodecError::UnknownVersion(2))
    );
}

#[test]
fn garbage_is_malformed() {
    assert!(matches!(
        from_bytes::<Event>(b"\xff\x00"),
        Err(CodecError::Malformed(_))
    ));
    let wrong_type = to_bytes(&7u8);
    assert!(matches!(
        from_bytes::<Event>(&wrong_type),
        Err(CodecError::Malformed(_))
    ));
}

#[test]
fn an_event_past_its_bound_is_refused() {
    let mut e = event("e1");
    e.body = Some(String::from_utf8(vec![b'x'; EVENT_MAX_BYTES]).expect("ascii"));
    assert!(matches!(
        event_to_bytes(&e),
        Err(CodecError::TooLarge {
            max: EVENT_MAX_BYTES,
            ..
        })
    ));
}
