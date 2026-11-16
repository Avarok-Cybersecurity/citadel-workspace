//! `sdk` and `sdk_query`: a route is recognised by method and path and nothing looser, an id in a
//! path survives escaping, every query the client builds parses back to itself, and a malformed
//! or ambiguous query is refused rather than guessed at. Each body crosses the versioned codec.

use crate::codec::{from_bytes, to_bytes};
use crate::model::{Location, Propagate, Visibility, When};
use crate::sdk::*;
use crate::sdk_query::*;
use crate::tz::Zone;
use citadel_app_sdk_types::calls::HttpMethod;
use proptest::prelude::*;
use std::string::String;
use std::vec;
use std::vec::Vec;

#[test]
fn routes_are_matched_by_method_and_path_only() {
    assert_eq!(sdk_route(&HttpMethod::Get, "/events"), Some(SdkRoute::List));
    assert_eq!(
        sdk_route(&HttpMethod::Post, "/events"),
        Some(SdkRoute::Create)
    );
    assert_eq!(
        sdk_route(&HttpMethod::Patch, "/events/e%2F1"),
        Some(SdkRoute::Patch { id: "e/1".into() })
    );
    assert_eq!(
        sdk_route(&HttpMethod::Delete, &event_path("ab c")),
        Some(SdkRoute::Delete { id: "ab c".into() })
    );
    assert_eq!(
        sdk_route(&HttpMethod::Get, "/health"),
        Some(SdkRoute::Health)
    );
    for (m, p) in [
        (HttpMethod::Post, "/events/e1"),
        (HttpMethod::Get, "/events/e1"),
        (HttpMethod::Patch, "/events/"),
        (HttpMethod::Delete, "/events/a/b"),
        (HttpMethod::Put, "/events"),
        (HttpMethod::Delete, "/events/%zz"),
    ] {
        assert_eq!(sdk_route(&m, p), None, "{m:?} {p}");
    }
}

#[test]
fn every_served_route_is_recognised_and_only_mutations_need_consent() {
    let mutating: Vec<bool> = sdk_routes()
        .iter()
        .map(|r| {
            sdk_route(&r.method, &r.path.replace(":id", "e1"))
                .expect("served")
                .mutates()
        })
        .collect();
    assert_eq!(mutating, [false, true, true, true, false, false]);
}

proptest! {
    #[test]
    fn escaping_round_trips_any_text(text in "\\PC{0,40}") {
        let escaped = escape(&text);
        prop_assert!(escaped.bytes().all(|b| b.is_ascii_alphanumeric() || b"-._~%".contains(&b)));
        prop_assert_eq!(unescape(&escaped), Some(text));
    }

    #[test]
    fn a_built_list_query_parses_to_itself(node in "\\PC{1,20}", from in 0i64..1 << 50, len in 1i64..1 << 30, include in 0usize..3) {
        let q = ListQuery { node, from_ms: from, to_ms: from + len, include: [Include::Own, Include::Inherited, Include::Up][include] };
        prop_assert_eq!(parse_list_query(&list_query_string(&q)), Ok(q));
    }

    #[test]
    fn a_built_free_busy_query_parses_to_itself(users in prop::collection::vec("\\PC{1,12}", 1..6), from in 0i64..1 << 50) {
        let q = FreeBusyQuery { node: "n,1".into(), users, from_ms: from, to_ms: from + 1 };
        prop_assert_eq!(parse_free_busy_query(&free_busy_query_string(&q)), Ok(q));
    }
}

#[test]
fn a_malformed_or_ambiguous_query_is_refused() {
    let refused = |q: &str| parse_list_query(q).map_err(|r| r.code);
    for q in [
        "node=n&from=1&to=2",
        "node=n&from=1&to=2&include=all",
        "node=n&from=2&to=1&include=own",
        "node=n&from=-1&to=2&include=own",
        "node=n&node=m&from=1&to=2&include=own",
        "node=n&from=1&to=2&include=own&x=1",
        "node=%G0&from=1&to=2&include=own",
        "node=&from=1&to=2&include=own",
    ] {
        assert_eq!(refused(q), Err(SdkCode::BadRequest), "{q}");
    }
    let fb = |q: &str| parse_free_busy_query(q).map_err(|r| r.code);
    let many: Vec<String> = (0..=MAX_FREE_BUSY_USERS)
        .map(|i| std::format!("u{i}"))
        .collect();
    for q in [
        String::from("node=n&from=1&to=2"),
        String::from("node=n&users=a,,b&from=1&to=2"),
        String::from("node=n&users=a&users=b&from=1&to=2"),
        std::format!("node=n&users={}&from=1&to=2", many.join(",")),
    ] {
        assert_eq!(fb(&q), Err(SdkCode::BadRequest), "{q}");
    }
}

#[test]
fn bodies_cross_the_versioned_codec() {
    let new = NewEvent {
        node: "n1".into(),
        title: "Standup".into(),
        when: When::Once {
            start_ms: 1,
            end_ms: 2,
        },
        zone: Zone::new("Europe/Berlin").expect("a zone"),
        location: Location::InApp,
        visibility: Visibility::Public,
        propagate: Propagate {
            down: false,
            up_to: Some("root".into()),
        },
        reminders: vec![],
        reference: "kanban:card-7".into(),
    };
    assert_eq!(from_bytes::<NewEvent>(&to_bytes(&new)), Ok(new));
    let patch = EventPatch {
        rev: 3,
        title: None,
        when: None,
        zone: None,
        location: Some(Location::Text {
            text: "Room 4".into(),
        }),
        reminders: None,
    };
    assert_eq!(from_bytes::<EventPatch>(&to_bytes(&patch)), Ok(patch));
    let refusal = SdkRefusal::stale(4);
    assert_eq!(from_bytes::<SdkRefusal>(&to_bytes(&refusal)), Ok(refusal));
}

#[test]
fn each_refusal_has_its_status() {
    let statuses: Vec<u16> = [
        SdkCode::CrossUser,
        SdkCode::NotConsented,
        SdkCode::NotYours,
        SdkCode::Stale,
        SdkCode::NotFound,
        SdkCode::Invalid,
        SdkCode::Limit,
        SdkCode::BadRequest,
    ]
    .iter()
    .map(|c| c.status())
    .collect();
    assert_eq!(statuses, [403, 403, 403, 409, 404, 422, 429, 400]);
}
