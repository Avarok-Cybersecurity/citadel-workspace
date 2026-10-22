//! Writes the signed admin requests deploy/tenant-worker/test/admin-verifier.test.mjs checks
//! through the real verifier, all made at one fixed instant with a fixed test key (never a real
//! one; the same seed as support_fixtures, so one key signs under both domains):
//!
//!   cargo run -p citadel-support-signature --example admin_fixtures -- <out.json>
//!
//! Rerun it when the format changes; the test fails until the fixtures match the verifier.

use citadel_support_signature::{
    AdminAction, AdminRequest, AdminSigningKey, CouponShape, RequestSigningKey, SignedRequest,
    SupportAction, SupportRequest, SupportSigningKey, ADMIN_DOMAIN, NONCE_LEN, SEED_LEN,
};

// Fixed: the fixtures are reproducible, and the keys sign nothing real.
const SEED: [u8; SEED_LEN] = [0x5e; SEED_LEN];
const OTHER_SEED: [u8; SEED_LEN] = [0x0e; SEED_LEN];
const NOW_MS: u64 = 1_800_000_000_000;
const LIFETIME_MS: u64 = 120_000;
const AUDIENCE: &str = "work.avarok.net";

fn issue() -> AdminAction {
    AdminAction::IssueCoupon {
        code: "PARTNER-ACME".to_string(),
        shape: CouponShape::Grant("design-partner".to_string()),
        available_on: vec!["business".to_string()],
        intervals: vec!["month".to_string(), "year".to_string()],
        max_redemptions: 1,
        redeem_by_ms: Some(NOW_MS + 30 * 24 * 3_600_000),
        note: "acme design partner".to_string(),
    }
}

fn issue_template() -> AdminAction {
    AdminAction::IssueCoupon {
        code: "SPRING-TEAM".to_string(),
        shape: CouponShape::Template("pct-10-once".to_string()),
        available_on: vec!["team".to_string(), "business".to_string()],
        intervals: vec!["month".to_string()],
        max_redemptions: 50,
        redeem_by_ms: None,
        note: String::new(),
    }
}

fn revoke() -> AdminAction {
    AdminAction::RevokeCoupon {
        code: "PARTNER-ACME".to_string(),
        also_revoke_grants: true,
    }
}

fn request(action: AdminAction, nonce: u8, made_at: u64) -> AdminRequest {
    AdminRequest::new(AUDIENCE, action, &[nonce; NONCE_LEN], made_at, LIFETIME_MS)
        .expect("a valid lifetime")
}

fn body(signed: &SignedRequest) -> String {
    serde_json::to_string(signed).expect("serialises")
}

fn main() {
    let out = std::env::args()
        .nth(1)
        .expect("usage: admin_fixtures <out.json>");
    let key = AdminSigningKey::from_seed(&SEED);
    let sign = |r: &AdminRequest| body(&key.sign(r));

    let tampered = {
        let mut signed = key.sign(&request(revoke(), 5, NOW_MS));
        signed.payload = signed.payload.replace("true", "false");
        body(&signed)
    };
    // What a signer that leaves the choice out would send: refused, never read as either answer.
    let revoke_unstated = {
        let mut value = serde_json::to_value(request(revoke(), 6, NOW_MS)).expect("serialises");
        let fields = value["action"]
            .as_object_mut()
            .expect("an internally tagged action");
        fields.remove("also_revoke_grants").expect("present");
        body(&RequestSigningKey::from_seed(&SEED).seal(ADMIN_DOMAIN, &value))
    };
    let support_read = SupportRequest::new(
        AUDIENCE,
        SupportAction::ListGrants,
        &[7; NONCE_LEN],
        NOW_MS,
        LIFETIME_MS,
    )
    .expect("a valid lifetime");
    let fixtures = serde_json::json!({
        "generated_by": "cargo run -p citadel-support-signature --example admin_fixtures",
        "now_ms": NOW_MS,
        "audience": AUDIENCE,
        "public_key": key.public_key_hex(),
        "requests": {
            "issue_grant": sign(&request(issue(), 1, NOW_MS)),
            "revoke_with_grants": sign(&request(revoke(), 2, NOW_MS)),
            "issue_template": sign(&request(issue_template(), 9, NOW_MS)),
            "list_coupons": sign(&request(AdminAction::ListCoupons, 3, NOW_MS)),
            "list_redemptions": sign(&request(
                AdminAction::ListRedemptions { code: "PARTNER-ACME".to_string() },
                10,
                NOW_MS,
            )),
            "expired": sign(&request(AdminAction::ListCoupons, 4, NOW_MS - LIFETIME_MS)),
            "tampered": tampered,
            "revoke_unstated": revoke_unstated,
            "wrong_key": body(&AdminSigningKey::from_seed(&OTHER_SEED).sign(&request(issue(), 8, NOW_MS))),
            "support_signed": body(&SupportSigningKey::from_seed(&SEED).sign(&support_read)),
        },
    });
    let text = serde_json::to_string_pretty(&fixtures).expect("serialises") + "\n";
    std::fs::write(&out, text).unwrap_or_else(|e| panic!("{out}: {e}"));
    println!("wrote {out}");
}
