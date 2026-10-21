use super::*;
use crate::{verify, SupportAction, SupportRequest, SupportSigningKey, DOMAIN, MAX_LIFETIME_MS};

// Fixed seeds: the tests need a reproducible key pair, never a real one.
pub(super) const SEED: [u8; SEED_LEN] = [7; SEED_LEN];
const OTHER_SEED: [u8; SEED_LEN] = [9; SEED_LEN];
pub(super) const NONCE: [u8; NONCE_LEN] = [0xcd; NONCE_LEN];
pub(super) const AUDIENCE: &str = "work.avarok.net";
pub(super) const NOW: u64 = 1_800_000_000_000;

pub(super) fn issue() -> AdminAction {
    AdminAction::IssueCoupon {
        code: "PARTNER-ACME".to_string(),
        shape: CouponShape::Grant("design-partner".to_string()),
        available_on: vec!["business".to_string()],
        intervals: vec!["month".to_string()],
        max_redemptions: 1,
        redeem_by_ms: Some(NOW + 30 * 24 * 3_600_000),
        note: "acme design partner".to_string(),
    }
}

pub(super) fn request(action: AdminAction) -> AdminRequest {
    AdminRequest::new(AUDIENCE, action, &NONCE, NOW, 60_000).expect("a valid lifetime")
}

pub(super) fn key() -> AdminSigningKey {
    AdminSigningKey::from_seed(&SEED)
}

pub(super) fn public_key() -> String {
    key().public_key_hex()
}

/// `payload` signed under `domain` by the test key: what a key holder could sign by mistake.
pub(super) fn sealed<T: Serialize>(domain: &[u8], payload: &T) -> SignedAdminRequest {
    RequestSigningKey::from_seed(&SEED).seal(domain, payload)
}

fn support_read() -> SupportRequest {
    SupportRequest::new(AUDIENCE, SupportAction::ListGrants, &NONCE, NOW, 60_000).expect("valid")
}

#[test]
fn every_action_signed_verifies_and_round_trips() {
    let actions = [
        issue(),
        AdminAction::IssueCoupon {
            code: "LAUNCH-20".to_string(),
            shape: CouponShape::Template("pct-20-3mo".to_string()),
            available_on: vec!["team".to_string(), "business".to_string()],
            intervals: vec!["month".to_string()],
            max_redemptions: 100,
            redeem_by_ms: None,
            note: String::new(),
        },
        AdminAction::RevokeCoupon {
            code: "PARTNER-ACME".to_string(),
            also_revoke_grants: true,
        },
        AdminAction::RevokeCoupon {
            code: "PARTNER-ACME".to_string(),
            also_revoke_grants: false,
        },
        AdminAction::ListCoupons,
        AdminAction::ListRedemptions {
            code: "PARTNER-ACME".to_string(),
        },
    ];
    for action in actions {
        let signed = key().sign(&request(action.clone()));
        let got = verify_admin(&public_key(), &signed, AUDIENCE, NOW).expect("verifies");
        assert_eq!(got.action, action);
        assert_eq!(got.nonce, "cd".repeat(NONCE_LEN));
    }
}

#[test]
fn the_three_domains_do_not_overlap() {
    let release = citadel_release_signature::DOMAIN;
    for (a, b) in [(ADMIN_DOMAIN, DOMAIN), (ADMIN_DOMAIN, release)] {
        assert!(!a.starts_with(b) && !b.starts_with(a));
    }
}

#[test]
fn a_support_signature_by_the_same_key_is_not_an_admin_one() {
    let support = SupportSigningKey::from_seed(&SEED);
    assert_eq!(
        support.public_key_hex(),
        public_key(),
        "one key, two domains"
    );
    // The admin payload itself, signed under the support domain.
    let forged = sealed(DOMAIN, &request(issue()));
    assert_eq!(
        verify_admin(&public_key(), &forged, AUDIENCE, NOW),
        Err(Refusal::Invalid)
    );
    // A genuine support request.
    assert_eq!(
        verify_admin(&public_key(), &support.sign(&support_read()), AUDIENCE, NOW),
        Err(Refusal::Invalid)
    );
    // Control: the same payload under the admin domain verifies, so the domain is what refused.
    let genuine = sealed(ADMIN_DOMAIN, &request(issue()));
    assert_eq!(genuine.payload, forged.payload);
    assert!(verify_admin(&public_key(), &genuine, AUDIENCE, NOW).is_ok());
}

#[test]
fn an_admin_signature_by_the_same_key_is_not_a_support_one() {
    let forged = sealed(ADMIN_DOMAIN, &support_read());
    assert_eq!(
        verify(&public_key(), &forged, AUDIENCE, NOW),
        Err(Refusal::Invalid)
    );
    let issue = key().sign(&request(issue()));
    assert_eq!(
        verify(&public_key(), &issue, AUDIENCE, NOW),
        Err(Refusal::Invalid)
    );
    // Control: the same payload under the support domain verifies.
    assert!(verify(
        &public_key(),
        &sealed(DOMAIN, &support_read()),
        AUDIENCE,
        NOW
    )
    .is_ok());
}

#[test]
fn another_keys_signature_is_refused() {
    let signed = AdminSigningKey::from_seed(&OTHER_SEED).sign(&request(issue()));
    assert_eq!(
        verify_admin(&public_key(), &signed, AUDIENCE, NOW),
        Err(Refusal::Invalid)
    );
}

#[test]
fn a_tampered_action_is_refused() {
    let signed = key().sign(&request(AdminAction::RevokeCoupon {
        code: "PARTNER-ACME".to_string(),
        also_revoke_grants: false,
    }));
    let tampered = SignedAdminRequest {
        payload: signed.payload.replace("false", "true"),
        ..signed.clone()
    };
    assert_ne!(tampered.payload, signed.payload, "the tamper applied");
    assert_eq!(
        verify_admin(&public_key(), &tampered, AUDIENCE, NOW),
        Err(Refusal::Invalid)
    );
    assert!(verify_admin(&public_key(), &signed, AUDIENCE, NOW).is_ok());
}

#[test]
fn another_control_planes_request_is_refused() {
    let signed = key().sign(&request(issue()));
    assert_eq!(
        verify_admin(&public_key(), &signed, "localhost", NOW),
        Err(Refusal::WrongAudience)
    );
}

#[test]
fn an_expired_or_too_long_request_is_refused() {
    let signed = key().sign(&request(issue()));
    assert_eq!(
        verify_admin(&public_key(), &signed, AUDIENCE, NOW + 60_000),
        Err(Refusal::Expired)
    );
    assert!(verify_admin(&public_key(), &signed, AUDIENCE, NOW + 59_999).is_ok());
    assert_eq!(
        AdminRequest::new(AUDIENCE, issue(), &NONCE, NOW, MAX_LIFETIME_MS + 1),
        Err(Refusal::LifetimeTooLong)
    );
    let mut long = request(issue());
    long.expires_at_ms = NOW + MAX_LIFETIME_MS + 1;
    assert_eq!(
        verify_admin(&public_key(), &key().sign(&long), AUDIENCE, NOW),
        Err(Refusal::LifetimeTooLong)
    );
}

#[test]
fn refusals_name_the_admin_key() {
    assert_eq!(
        Refusal::Invalid.describe("admin"),
        "the signature does not verify against the admin key"
    );
    assert_eq!(
        Refusal::Invalid.to_string(),
        "the signature does not verify against the support key"
    );
}
