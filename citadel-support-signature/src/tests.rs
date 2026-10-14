use super::*;
use citadel_workspace_types::telemetry::TelemetryLevel;

// Fixed seeds: the tests need a reproducible key pair, never a real one.
const SEED: [u8; SEED_LEN] = [7; SEED_LEN];
const OTHER_SEED: [u8; SEED_LEN] = [9; SEED_LEN];
const NONCE: [u8; NONCE_LEN] = [0xab; NONCE_LEN];
const AUDIENCE: &str = "work.avarok.net";
const NOW: u64 = 1_800_000_000_000;

fn fetch() -> SupportAction {
    SupportAction::FetchTelemetry {
        tenant: "acme".to_string(),
        filter: TelemetryFilter {
            user_id: None,
            peer_cid: Some(42),
            min_level: Some(TelemetryLevel::Error),
            since_ms: None,
            until_ms: None,
        },
        page: TelemetryPage {
            offset: 0,
            limit: 50,
        },
    }
}

fn request(lifetime_ms: u64) -> SupportRequest {
    SupportRequest::new(AUDIENCE, fetch(), &NONCE, NOW, lifetime_ms).expect("a valid lifetime")
}

fn public_key() -> String {
    SupportSigningKey::from_seed(&SEED).public_key_hex()
}

#[test]
fn a_signed_request_verifies_and_carries_its_query() {
    let signed = SupportSigningKey::from_seed(&SEED).sign(&request(60_000));
    let got = verify(&public_key(), &signed, AUDIENCE, NOW).expect("verifies");
    assert_eq!(got, request(60_000));
    assert_eq!(got.nonce, "ab".repeat(NONCE_LEN));
    assert_eq!(public_key().len(), PUBLIC_KEY_LEN * 2);
    assert_eq!(signed.signature.len(), SIGNATURE_LEN * 2);
}

#[test]
fn another_keys_signature_is_refused() {
    let signed = SupportSigningKey::from_seed(&OTHER_SEED).sign(&request(60_000));
    assert_eq!(
        verify(&public_key(), &signed, AUDIENCE, NOW),
        Err(Refusal::Invalid)
    );
}

#[test]
fn a_changed_payload_is_refused() {
    let mut signed = SupportSigningKey::from_seed(&SEED).sign(&request(60_000));
    signed.payload = signed.payload.replace("acme", "acmf");
    assert_eq!(
        verify(&public_key(), &signed, AUDIENCE, NOW),
        Err(Refusal::Invalid)
    );
}

#[test]
fn a_release_domain_signature_by_the_same_key_is_refused() {
    let payload = serde_json::to_string(&request(60_000)).expect("serialises");
    let mut message = citadel_release_signature::DOMAIN.to_vec();
    message.extend_from_slice(payload.as_bytes());
    let mut xi = Seed::default();
    xi.copy_from_slice(&SEED);
    let key = SigningKey::<MlDsa65>::from_seed(&xi);
    let signature: Signature<MlDsa65> = key.sign(&message);
    let signed = SignedSupportRequest {
        payload,
        signature: hex::encode(signature.encode().as_slice()),
    };
    assert_eq!(
        verify(&public_key(), &signed, AUDIENCE, NOW),
        Err(Refusal::Invalid)
    );
}

#[test]
fn a_real_release_signature_is_not_a_support_signature() {
    let release = citadel_release_signature::ReleaseSigningKey::from_seed(&SEED);
    assert_eq!(
        release.public_key_hex(),
        public_key(),
        "one key, two domains"
    );
    let payload = serde_json::to_string(&request(60_000)).expect("serialises");
    let digest = citadel_release_signature::sha256(payload.as_bytes());
    let signature = release.sign("agent-v1.0.0", "a", &digest).expect("signs");
    let signed = SignedSupportRequest { payload, signature };
    assert_eq!(
        verify(&public_key(), &signed, AUDIENCE, NOW),
        Err(Refusal::Invalid)
    );
}

#[test]
fn the_domains_do_not_overlap() {
    let release = citadel_release_signature::DOMAIN;
    assert!(!DOMAIN.starts_with(release) && !release.starts_with(DOMAIN));
}

#[test]
fn an_expired_request_is_refused() {
    let signed = SupportSigningKey::from_seed(&SEED).sign(&request(60_000));
    let key = public_key();
    assert_eq!(
        verify(&key, &signed, AUDIENCE, NOW + 60_000),
        Err(Refusal::Expired)
    );
    assert!(verify(&key, &signed, AUDIENCE, NOW + 59_999).is_ok());
}

#[test]
fn a_request_living_longer_than_five_minutes_is_refused() {
    assert_eq!(
        SupportRequest::new(AUDIENCE, fetch(), &NONCE, NOW, MAX_LIFETIME_MS + 1),
        Err(Refusal::LifetimeTooLong)
    );
    let mut long = request(MAX_LIFETIME_MS);
    long.expires_at_ms += 1;
    let signed = SupportSigningKey::from_seed(&SEED).sign(&long);
    assert_eq!(
        verify(&public_key(), &signed, AUDIENCE, NOW),
        Err(Refusal::LifetimeTooLong)
    );
}

#[test]
fn another_control_planes_request_is_refused() {
    let signed = SupportSigningKey::from_seed(&SEED).sign(&request(60_000));
    assert_eq!(
        verify(&public_key(), &signed, "localhost", NOW),
        Err(Refusal::WrongAudience)
    );
}

#[test]
fn a_short_nonce_is_refused_even_when_signed() {
    let mut short = request(60_000);
    short.nonce = "ab".to_string();
    let signed = SupportSigningKey::from_seed(&SEED).sign(&short);
    assert!(matches!(
        verify(&public_key(), &signed, AUDIENCE, NOW),
        Err(Refusal::MalformedRequest(_))
    ));
}

#[test]
fn an_unknown_field_is_refused_even_when_signed() {
    let payload = serde_json::to_string(&request(60_000))
        .expect("serialises")
        .replacen('{', "{\"extra\":1,", 1);
    let signature: Signature<MlDsa65> = {
        let mut xi = Seed::default();
        xi.copy_from_slice(&SEED);
        SigningKey::<MlDsa65>::from_seed(&xi).sign(&signed_message(&payload))
    };
    let signed = SignedSupportRequest {
        payload,
        signature: hex::encode(signature.encode().as_slice()),
    };
    assert!(matches!(
        verify(&public_key(), &signed, AUDIENCE, NOW),
        Err(Refusal::MalformedRequest(_))
    ));
}

#[test]
fn a_malformed_key_or_signature_is_refused() {
    let signed = SupportSigningKey::from_seed(&SEED).sign(&request(60_000));
    assert!(matches!(
        verify("00", &signed, AUDIENCE, NOW),
        Err(Refusal::MalformedKey(_))
    ));
    let truncated = SignedSupportRequest {
        signature: signed.signature[2..].to_string(),
        ..signed
    };
    assert!(matches!(
        verify(&public_key(), &truncated, AUDIENCE, NOW),
        Err(Refusal::MalformedSignature(_))
    ));
}
