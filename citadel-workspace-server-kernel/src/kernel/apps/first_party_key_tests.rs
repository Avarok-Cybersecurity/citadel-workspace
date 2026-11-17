//! The first-party publisher key is the owner's, intact, and the only key `is_first_party` accepts.

use super::install::{is_first_party, FIRST_PARTY_PUBLISHER_KEYS};
use citadel_app_signature::{fingerprint, AppSigningKey};

/// The fingerprint the owner read off the key they generated.
const OWNER_FINGERPRINT: &str = "34b0 a177 4fb3 cb9b";

#[test]
fn the_listed_key_is_the_owners_and_is_first_party() {
    let [key] = FIRST_PARTY_PUBLISHER_KEYS else {
        panic!(
            "one first-party key, not {}",
            FIRST_PARTY_PUBLISHER_KEYS.len()
        );
    };
    assert_eq!(
        fingerprint(key).expect("a well-formed ML-DSA-65 key"),
        OWNER_FINGERPRINT
    );
    assert!(is_first_party(key));
}

#[test]
fn another_key_is_not_first_party() {
    let other = AppSigningKey::from_seed_hex(&"11".repeat(32))
        .expect("seed")
        .public_key_hex();
    assert!(!is_first_party(&other));
    assert!(!is_first_party(""));
    let [key] = FIRST_PARTY_PUBLISHER_KEYS else {
        panic!("one first-party key");
    };
    assert!(
        !is_first_party(&key.to_uppercase()),
        "the key is compared exactly"
    );
}
