//! An app publisher's ML-DSA signature (`citadel-app-signature`) and an Avarok support request's
//! are made under different domains, so a key used for both cannot have one taken for the other,
//! in either direction. Each refusal sits beside the same signature accepted in its own domain.

use citadel_app_signature::{verify as verify_app, AppSigningKey, ArtifactDigests};
use citadel_support_signature::*;

const SEED: [u8; SEED_LEN] = [7; SEED_LEN];
const AUDIENCE: &str = "work.avarok.net";
const NOW: u64 = 1_800_000_000_000;

fn request() -> SupportRequest {
    let action = SupportAction::FetchTelemetry {
        tenant: "acme".to_string(),
        filter: citadel_workspace_types::telemetry::TelemetryFilter {
            user_id: None,
            peer_cid: None,
            min_level: None,
            since_ms: None,
            until_ms: None,
        },
        page: citadel_workspace_types::telemetry::TelemetryPage {
            offset: 0,
            limit: 50,
        },
    };
    SupportRequest::new(AUDIENCE, action, &[0xab; NONCE_LEN], NOW, 60_000)
        .expect("a valid lifetime")
}

#[test]
fn a_support_signature_is_not_an_app_signature() {
    let support = SupportSigningKey::from_seed(&SEED);
    let signed = support.sign(&request());
    let key = support.public_key_hex();
    let digests = ArtifactDigests::of(signed.payload.as_bytes(), b"");
    assert!(verify_app(
        &key,
        "com.acme.kanban",
        "1.0.0",
        &digests,
        &signed.signature
    )
    .is_err());
    // Control: it is a valid support signature, so only the domain refused it.
    assert!(verify(&key, &signed, AUDIENCE, NOW).is_ok());
}

#[test]
fn an_app_signature_is_not_a_support_signature() {
    let app = AppSigningKey::from_seed(&SEED);
    let key = app.public_key_hex();
    assert_eq!(
        key,
        SupportSigningKey::from_seed(&SEED).public_key_hex(),
        "one key, two domains"
    );
    let payload = serde_json::to_string(&request()).expect("serialises");
    let digests = ArtifactDigests::of(payload.as_bytes(), b"");
    let signature = app
        .sign("com.acme.kanban", "1.0.0", &digests)
        .expect("signs");
    let forged = SignedSupportRequest {
        payload,
        signature: signature.clone(),
    };
    assert_eq!(verify(&key, &forged, AUDIENCE, NOW), Err(Refusal::Invalid));
    // Control: it is a valid app signature.
    assert_eq!(
        verify_app(&key, "com.acme.kanban", "1.0.0", &digests, &signature),
        Ok(())
    );
}

#[test]
fn the_domains_do_not_overlap() {
    let app = citadel_app_signature::DOMAIN;
    assert!(!DOMAIN.starts_with(app) && !app.starts_with(DOMAIN));
}
