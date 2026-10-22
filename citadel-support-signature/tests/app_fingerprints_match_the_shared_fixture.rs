//! The consent screen shows a publisher key's fingerprint, computed in the browser
//! (citadel-workspaces/src/lib/citadel-apps/fingerprint.ts). Both it and `citadel-app-signature`'s
//! `fingerprint` are held to the same fixture, so neither can drift into agreeing only with itself:
//! the expected values were computed by an independent sha256, not by either implementation.

use citadel_app_signature::fingerprint;
use serde::Deserialize;

#[derive(Deserialize)]
struct Case {
    name: String,
    public_key: String,
    fingerprint: Option<String>,
}

#[test]
fn every_fixture_fingerprint_is_the_crates() {
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../apps/catalogue/fixtures/app-fingerprint-fixtures.json"
    );
    let text = std::fs::read_to_string(path).expect("the shared fixture is readable");
    let cases: Vec<Case> = serde_json::from_str(&text).expect("the fixture is a list of cases");
    assert!(cases.iter().any(|c| c.fingerprint.is_some()));
    assert!(cases.iter().any(|c| c.fingerprint.is_none()));
    for case in cases {
        assert_eq!(
            fingerprint(&case.public_key).ok(),
            case.fingerprint,
            "{}",
            case.name
        );
    }
}
