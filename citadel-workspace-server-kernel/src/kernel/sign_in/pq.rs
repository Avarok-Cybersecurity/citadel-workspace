//! Post-quantum sign-in's server settings, built from an OPRF seed, the Argon2id cost clients
//! stretch a password factor with, and the WebAuthn relying party the server's security keys are
//! scoped to. The one builder both hosts use: the native server (`native::resolve`, from
//! kernel.toml's `[sign_in]`) and the Durable Object (server-wasm `PqSignIn`, from the object's
//! stored seed, `PQ_KSF_*` and `PQ_SECURITY_KEY_RP_ID`).
//!
//! The relying party has no default. A key enrolled under one ID can never sign in under another,
//! and the server names it in every challenge, so it must be the ID the server's browser clients
//! have always used (`citadel-workspaces/src/lib/passkey/rp-id.ts`).

use super::{KsfParams, OprfSeed, PqAuthServerSettings};
use citadel_user::auth::pq::throttle::ThrottlePolicy;

/// How often a key may fail or start a sign-in or a recovery before it is locked out, on both
/// hosts: the SDK's recommendation (five failures or twenty starts per fifteen minutes, a lockout
/// of one minute doubling to an hour). The SDK has no default; this is the one place it is chosen.
pub const SIGN_IN_THROTTLE: ThrottlePolicy = ThrottlePolicy::RECOMMENDED;

/// An OPRF seed's length: 32 bytes from the platform CSPRNG (control/oprf-seed.mjs
/// `OPRF_SEED_BYTES`, `--init-sign-in-seed`).
pub const OPRF_SEED_BYTES: usize = 32;

/// The named Argon2id cost a kernel.toml may give instead of the three numbers: OWASP's minimum,
/// the SDK's floor, and what the hosted tenants run with (wrangler.toml `PQ_KSF_*`).
pub const KSF_PRESET_OWASP_FLOOR: &str = "owasp-floor";

/// The parameters a preset names, or `None` for a name that is not one.
pub fn ksf_preset(name: &str) -> Option<KsfParams> {
    (name == KSF_PRESET_OWASP_FLOOR).then_some(KsfParams::FLOOR)
}

/// The settings for `seed`, `ksf` and `security_key_rp_id`, or why there are none. The seed is
/// never printed: neither here nor by `OprfSeed`'s `Debug`.
pub fn pq_sign_in_settings(
    seed: &[u8],
    ksf: KsfParams,
    security_key_rp_id: &str,
) -> Result<PqAuthServerSettings, String> {
    let seed: [u8; OPRF_SEED_BYTES] = seed
        .try_into()
        .map_err(|_| format!("the OPRF seed is not {OPRF_SEED_BYTES} bytes"))?;
    PqAuthServerSettings::new(OprfSeed::from_bytes(seed), ksf, SIGN_IN_THROTTLE)
        .and_then(|settings| settings.with_security_key_rp_id(security_key_rp_id))
        .map_err(|e| format!("post-quantum sign-in settings: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The relying party these tests' settings name; any bare domain would do.
    const RP_ID: &str = "localhost";

    #[test]
    fn a_seed_of_any_other_length_is_refused() {
        for len in [0, 31, 33, 64] {
            let refused = pq_sign_in_settings(&vec![7; len], KsfParams::FLOOR, RP_ID).unwrap_err();
            assert!(refused.contains("32 bytes"), "{len}: {refused}");
        }
        assert!(pq_sign_in_settings(&[7; 32], KsfParams::FLOOR, RP_ID).is_ok());
    }

    #[test]
    fn the_relying_party_is_named_in_every_settings_and_must_be_a_bare_domain() {
        let settings = pq_sign_in_settings(&[7; 32], KsfParams::FLOOR, "work.avarok.net").unwrap();
        assert_eq!(settings.security_key_rp_id(), Some("work.avarok.net"));
        for refused in [
            "",
            "https://work.avarok.net",
            "work.avarok.net:443",
            "Work.Avarok.Net",
        ] {
            assert!(
                pq_sign_in_settings(&[7; 32], KsfParams::FLOOR, refused).is_err(),
                "{refused:?} was accepted as a relying party"
            );
        }
    }

    #[test]
    fn a_cost_below_the_floor_is_refused() {
        let weak = KsfParams {
            mem_kib: 1024,
            ..KsfParams::FLOOR
        };
        assert!(pq_sign_in_settings(&[7; 32], weak, RP_ID).is_err());
    }

    #[test]
    fn the_preset_is_the_floor_and_nothing_else_is_a_preset() {
        assert_eq!(ksf_preset("owasp-floor"), Some(KsfParams::FLOOR));
        assert_eq!(ksf_preset("OWASP-FLOOR"), None);
        assert_eq!(ksf_preset("default"), None);
    }
}
