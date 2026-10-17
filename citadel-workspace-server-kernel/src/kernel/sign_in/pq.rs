//! Post-quantum sign-in's server settings, built from an OPRF seed and the Argon2id cost clients
//! stretch a password factor with. The one builder both hosts use: the native server
//! (`native::resolve`, from kernel.toml's `[sign_in]`) and the Durable Object (server-wasm
//! `PqSignIn`, from the object's stored seed and `PQ_KSF_*`).

use super::{KsfParams, OprfSeed, PqAuthServerSettings};

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

/// The settings for `seed` and `ksf`, or why there are none. The seed is never printed: neither
/// here nor by `OprfSeed`'s `Debug`.
pub fn pq_sign_in_settings(seed: &[u8], ksf: KsfParams) -> Result<PqAuthServerSettings, String> {
    let seed: [u8; OPRF_SEED_BYTES] = seed
        .try_into()
        .map_err(|_| format!("the OPRF seed is not {OPRF_SEED_BYTES} bytes"))?;
    PqAuthServerSettings::new(OprfSeed::from_bytes(seed), ksf)
        .map_err(|e| format!("post-quantum sign-in settings: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_seed_of_any_other_length_is_refused() {
        for len in [0, 31, 33, 64] {
            let refused = pq_sign_in_settings(&vec![7; len], KsfParams::FLOOR).unwrap_err();
            assert!(refused.contains("32 bytes"), "{len}: {refused}");
        }
        assert!(pq_sign_in_settings(&[7; 32], KsfParams::FLOOR).is_ok());
    }

    #[test]
    fn a_cost_below_the_floor_is_refused() {
        let weak = KsfParams {
            mem_kib: 1024,
            ..KsfParams::FLOOR
        };
        assert!(pq_sign_in_settings(&[7; 32], weak).is_err());
    }

    #[test]
    fn the_preset_is_the_floor_and_nothing_else_is_a_preset() {
        assert_eq!(ksf_preset("owasp-floor"), Some(KsfParams::FLOOR));
        assert_eq!(ksf_preset("OWASP-FLOOR"), None);
        assert_eq!(ksf_preset("default"), None);
    }
}
