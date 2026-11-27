//! The first-party publisher key is the owner's, intact, and the only key `is_first_party` accepts.
//! The CI root is the published seed's key, in no production list, and trusted only by a build with
//! the `ci-first-party-root` feature.

use super::ci_first_party_root::{CI_FIRST_PARTY_PUBLISHER_KEYS, WITH_PRODUCTION};
use super::first_party::{plan_provisioning, SignedBundle};
use super::install::{
    is_first_party, trusted_first_party_keys, verify_listing, verify_listing_with,
    FIRST_PARTY_PUBLISHER_KEYS,
};
use citadel_app_signature::{fingerprint, sha256, sha256_from_hex, AppSigningKey, ArtifactDigests};
use citadel_workspace_types::apps_install::AppsRefusal;

/// The published test seed, as committed: 32 bytes of plain text.
const CI_SEED: &str = include_str!("ci_first_party_root.seed");

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

fn ci_key() -> AppSigningKey {
    AppSigningKey::from_seed_hex(&hex::encode(CI_SEED.as_bytes())).expect("the CI seed")
}

/// The committed Calendar (glue ABI) published by the CI root, as the integration job signs it.
fn ci_signed_calendar() -> (Vec<u8>, String) {
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../apps/first-party/calendar/manifest.json"
    );
    let bytes = std::fs::read(path).expect("the committed Calendar manifest");
    let mut value: serde_json::Value = serde_json::from_slice(&bytes).expect("json");
    let key = ci_key();
    value["publisher"]["mldsa65_public_key"] = key.public_key_hex().into();
    let manifest = serde_json::to_vec(&value).expect("json");
    let wasm =
        sha256_from_hex(value["artifact"]["sha256"].as_str().expect("a digest")).expect("hex");
    let digests = ArtifactDigests {
        manifest: sha256(&manifest),
        wasm,
    };
    let (id, version) = (value["id"].as_str(), value["version"].as_str());
    let signature = key
        .sign(id.expect("id"), version.expect("version"), &digests)
        .expect("sign");
    (manifest, signature)
}

#[test]
fn the_ci_root_is_the_published_seeds_key_and_no_production_key() {
    assert_eq!(CI_SEED.len(), 32, "a 32-byte seed, no trailing newline");
    let [ci] = CI_FIRST_PARTY_PUBLISHER_KEYS else {
        panic!("one CI key, not {}", CI_FIRST_PARTY_PUBLISHER_KEYS.len());
    };
    assert_eq!(*ci, ci_key().public_key_hex());
    assert_eq!(fingerprint(ci).expect("a key"), "78ca c1b3 d875 da14");
    assert!(!FIRST_PARTY_PUBLISHER_KEYS.contains(ci));
    let joined: Vec<&str> = FIRST_PARTY_PUBLISHER_KEYS
        .iter()
        .chain(CI_FIRST_PARTY_PUBLISHER_KEYS)
        .copied()
        .collect();
    assert_eq!(WITH_PRODUCTION.to_vec(), joined);
}

#[test]
fn this_build_trusts_the_ci_root_only_with_the_feature() {
    let ci = CI_FIRST_PARTY_PUBLISHER_KEYS[0];
    if cfg!(feature = "ci-first-party-root") {
        assert_eq!(trusted_first_party_keys(), &WITH_PRODUCTION[..]);
    } else {
        assert_eq!(trusted_first_party_keys(), FIRST_PARTY_PUBLISHER_KEYS);
        assert!(!is_first_party(ci));
    }
}

#[test]
fn a_release_the_ci_root_signed_is_first_party_only_with_the_feature() {
    let (manifest, signature) = ci_signed_calendar();
    let bundle = SignedBundle {
        manifest: &manifest,
        signature: &signature,
        module: None,
    };
    assert!(verify_listing_with(&manifest, &signature, &WITH_PRODUCTION).is_ok());
    assert!(plan_provisioning(&bundle, &WITH_PRODUCTION).is_ok());
    if !cfg!(feature = "ci-first-party-root") {
        assert!(matches!(
            verify_listing(&manifest, &signature),
            Err(AppsRefusal::InvalidManifest(_))
        ));
        assert!(plan_provisioning(&bundle, trusted_first_party_keys()).is_err());
    }
}
