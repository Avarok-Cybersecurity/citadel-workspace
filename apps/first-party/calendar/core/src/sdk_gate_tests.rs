//! `sdk_gate`: an app in another member's session is refused on every route but `/health`
//! whatever the member consented to; a mutation waits for consent and a refusal sticks; at most
//! sixty changes a minute per app.

use crate::sdk::{SdkCode, SdkRoute};
use crate::sdk_gate::*;
use std::vec;
use std::vec::Vec;

const ROUTES: [SdkRoute; 5] = [
    SdkRoute::List,
    SdkRoute::Create,
    SdkRoute::FreeBusy,
    SdkRoute::Health,
    SdkRoute::List,
];

#[test]
fn another_members_app_is_refused_on_every_route_but_health() {
    for route in ROUTES.iter().chain(
        [
            SdkRoute::Patch { id: "e".into() },
            SdkRoute::Delete { id: "e".into() },
        ]
        .iter(),
    ) {
        let got = gate(route, "bob", "amy", Some(Consent::Allow));
        if *route == SdkRoute::Health {
            assert_eq!(got, Gate::Proceed);
        } else {
            assert!(
                matches!(got, Gate::Refuse(ref r) if r.code == SdkCode::CrossUser),
                "{route:?}: {got:?}"
            );
        }
    }
}

#[test]
fn a_mutation_waits_for_consent_and_a_refusal_sticks() {
    assert_eq!(gate(&SdkRoute::Create, "amy", "amy", None), Gate::Ask);
    assert_eq!(
        gate(&SdkRoute::Create, "amy", "amy", Some(Consent::Allow)),
        Gate::Proceed
    );
    assert!(
        matches!(gate(&SdkRoute::Delete { id: "e".into() }, "amy", "amy", Some(Consent::Refuse)), Gate::Refuse(ref r) if r.code == SdkCode::NotConsented)
    );
    assert_eq!(gate(&SdkRoute::List, "amy", "amy", None), Gate::Proceed);
}

#[test]
fn sixty_mutations_a_minute_per_app() {
    let recent: Vec<u64> = (0..60).map(|i| 100_000 + i).collect();
    assert_eq!(rate_admit(&recent, 100_100), None);
    assert_eq!(rate_admit(&recent[1..], 100_100).map(|k| k.len()), Some(60));
    assert_eq!(
        rate_admit(&recent, 160_000).map(|k| k.len()),
        Some(60),
        "the window has passed the first"
    );
    assert_eq!(
        rate_admit(&[1, 2], 200_000),
        Some(vec![200_000]),
        "what left the window is dropped"
    );
}
