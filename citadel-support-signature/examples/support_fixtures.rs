//! Writes the signed requests deploy/tenant-worker/test/support.test.mjs replays against the real
//! Worker, all made at one fixed instant with a fixed test key (never a real one):
//!
//!   cargo run -p citadel-support-signature --example support_fixtures -- <out.json>
//!
//! Rerun it when the format changes; the test fails until the fixtures match the verifier.

use citadel_support_signature::{
    signed_message, SignedSupportRequest, SupportAction, SupportRequest, SupportSigningKey,
    MAX_LIFETIME_MS, NONCE_LEN, SEED_LEN,
};
use citadel_workspace_types::telemetry::{TelemetryFilter, TelemetryPage};
use ml_dsa::signature::Signer;
use ml_dsa::{MlDsa65, Seed, Signature, SigningKey};

// Fixed: the fixtures are reproducible, and the keys sign nothing real.
const SEED: [u8; SEED_LEN] = [0x5e; SEED_LEN];
const OTHER_SEED: [u8; SEED_LEN] = [0x0e; SEED_LEN];
const NOW_MS: u64 = 1_800_000_000_000;
const LIFETIME_MS: u64 = 120_000;
const AUDIENCE: &str = "work.avarok.net";

fn fetch(tenant: &str) -> SupportAction {
    SupportAction::FetchTelemetry {
        tenant: tenant.to_string(),
        filter: TelemetryFilter {
            user_id: None,
            peer_cid: None,
            min_level: None,
            since_ms: None,
            until_ms: None,
        },
        page: TelemetryPage {
            offset: 0,
            limit: 50,
        },
    }
}

fn request(action: SupportAction, nonce: u8, made_at: u64, lifetime: u64) -> SupportRequest {
    SupportRequest::new(AUDIENCE, action, &[nonce; NONCE_LEN], made_at, lifetime)
        .expect("a valid lifetime")
}

fn body(signed: &SignedSupportRequest) -> String {
    serde_json::to_string(signed).expect("serialises")
}

fn main() {
    let out = std::env::args()
        .nth(1)
        .expect("usage: support_fixtures <out.json>");
    let key = SupportSigningKey::from_seed(&SEED);
    let other = SupportSigningKey::from_seed(&OTHER_SEED);
    let sign = |r: &SupportRequest| body(&key.sign(r));

    let mut too_long = request(fetch("support-alpha"), 8, NOW_MS, MAX_LIFETIME_MS);
    too_long.expires_at_ms += 1;
    let release_domain = {
        let payload =
            serde_json::to_string(&request(fetch("support-alpha"), 9, NOW_MS, LIFETIME_MS))
                .expect("serialises");
        let mut message = citadel_release_signature::DOMAIN.to_vec();
        message.extend_from_slice(payload.as_bytes());
        let mut xi = Seed::default();
        xi.copy_from_slice(&SEED);
        let signature: Signature<MlDsa65> = SigningKey::<MlDsa65>::from_seed(&xi).sign(&message);
        assert_ne!(message, signed_message(&payload));
        body(&SignedSupportRequest {
            payload,
            signature: hex::encode(signature.encode().as_slice()),
        })
    };
    let fixtures = serde_json::json!({
        "generated_by": "cargo run -p citadel-support-signature --example support_fixtures",
        "now_ms": NOW_MS,
        "audience": AUDIENCE,
        "public_key": key.public_key_hex(),
        "requests": {
            "fetch_alpha": sign(&request(fetch("support-alpha"), 1, NOW_MS, LIFETIME_MS)),
            "fetch_alpha_replayed": sign(&request(fetch("support-alpha"), 2, NOW_MS, LIFETIME_MS)),
            "list_grants": sign(&request(SupportAction::ListGrants, 3, NOW_MS, LIFETIME_MS)),
            "list_grants_at_telemetry": sign(&request(SupportAction::ListGrants, 4, NOW_MS, LIFETIME_MS)),
            "fetch_unknown_tenant": sign(&request(fetch("support-nobody"), 5, NOW_MS, LIFETIME_MS)),
            "expired": sign(&request(fetch("support-alpha"), 6, NOW_MS - LIFETIME_MS, LIFETIME_MS)),
            "wrong_key": body(&other.sign(&request(fetch("support-alpha"), 7, NOW_MS, LIFETIME_MS))),
            "too_long": sign(&too_long),
            "release_domain": release_domain,
            "fetch_beta": sign(&request(fetch("support-beta"), 10, NOW_MS, LIFETIME_MS)),
            "list_grants_again": sign(&request(SupportAction::ListGrants, 11, NOW_MS, LIFETIME_MS)),
        },
    });
    let text = serde_json::to_string_pretty(&fixtures).expect("serialises") + "\n";
    std::fs::write(&out, text).unwrap_or_else(|e| panic!("{out}: {e}"));
    println!("wrote {out}");
}
