//! work.avarok.net's own identity as the "Sign in with Citadel" issuer (`sign-in-with-citadel.md`
//! §1a, §7): the control host runs no Citadel node, so it has no kernel and no `[identity]`; it has
//! a server key (from the Worker secret `CONTROL_SERVER_KEY_SEED`, never made here), an issuer-only
//! `/.well-known/citadel` (no `citadel` member), the assertions it signs with that same key, and
//! the identity proofs it verifies. The crate's code throughout, so the Worker and every verifier
//! read one format.

use citadel_identity::{
    canonical_domain, verify_proof, CanonicalDomain, MlDsa65Pk, ProofError, ServerKey,
    SignInAssertion, WellKnownCitadel, NONCE_LEN, SEED_LEN, WELL_KNOWN_VERSION,
};
use js_sys::{Object, Reflect, Uint8Array};
use sha3::{Digest, Sha3_256};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct IssuerIdentity {
    key: ServerKey,
    domain: CanonicalDomain,
    issued_at_s: u64,
}

fn array<const N: usize>(bytes: &[u8], what: &str) -> Result<[u8; N], JsError> {
    bytes
        .try_into()
        .map_err(|_| JsError::new(&format!("{what} is not {N} bytes")))
}

#[wasm_bindgen]
impl IssuerIdentity {
    /// `seed` is the 32-byte secret; `canonical` the control host; `issued_at_s` the
    /// `CONTROL_SERVER_KEY_ISSUED_AT` var, so every isolate serves the same document.
    #[wasm_bindgen(constructor)]
    pub fn new(seed: &[u8], canonical: &str, issued_at_s: u64) -> Result<IssuerIdentity, JsError> {
        let seed: [u8; SEED_LEN] = array(seed, "the issuer key seed")?;
        let domain = canonical_domain(canonical).map_err(|e| JsError::new(&e.to_string()))?;
        if domain.as_str() != canonical {
            return Err(JsError::new(&format!(
                "{canonical:?} is not a canonical domain"
            )));
        }
        Ok(Self {
            key: ServerKey::from_seed(&seed),
            domain,
            issued_at_s,
        })
    }

    /// The issuer-only `/.well-known/citadel` JSON: no `citadel` member, no former domains.
    pub fn well_known(&self) -> Result<Vec<u8>, JsError> {
        let doc = WellKnownCitadel {
            v: WELL_KNOWN_VERSION,
            canonical_domain: self.domain.clone(),
            citadel_wss: None,
            server_key: self.key.public_key().clone(),
            former_domains: Vec::new(),
            issued_at_s: self.issued_at_s,
        };
        self.key
            .sign_well_known(&doc)
            .map_err(|e| JsError::new(&format!("cannot build /.well-known/citadel: {e}")))
    }

    /// The assertion blob (identity-api.md §7) for the identity a proof established.
    pub fn sign_assertion(
        &self,
        identity_pk: &[u8],
        device: &str,
        aud: &str,
        exp_s: u64,
        nonce: &[u8],
    ) -> Result<Vec<u8>, JsError> {
        let assertion = SignInAssertion {
            identity: MlDsa65Pk::from_bytes(identity_pk)
                .map_err(|e| JsError::new(&e.to_string()))?,
            device: device.to_string(),
            aud: aud.to_string(),
            exp_s,
            nonce: array::<NONCE_LEN>(nonce, "the assertion nonce")?,
        };
        self.key
            .sign_assertion(&assertion)
            .map_err(|e| JsError::new(&e.to_string()))
    }
}

/// The contract's reason code for each way a proof is refused (§1a step 4).
fn reason(error: &ProofError) -> &'static str {
    match error {
        ProofError::Malformed(_) | ProofError::Version(_) | ProofError::Field(_) => {
            "malformed_proof"
        }
        ProofError::Signature(_) => "bad_signature",
        ProofError::WrongIssuer { .. } => "wrong_issuer",
        ProofError::WrongOrigin { .. } => "wrong_origin",
        ProofError::WrongAudience { .. } => "audience_mismatch",
        ProofError::WrongNonce => "nonce_mismatch",
        ProofError::WrongChallenge => "challenge_mismatch",
    }
}

fn set(target: &Object, name: &str, value: JsValue) -> Result<(), JsError> {
    Reflect::set(target, &name.into(), &value)
        .map(|_| ())
        .map_err(|_| JsError::new("cannot build the verified proof"))
}

/// `verify_proof` of the crate: `{ ok: true, identity_pk }` (the 1952 bytes the proof proved) or
/// `{ ok: false, reason, detail }`. Throws only when the expected nonce or challenge is not 32
/// bytes, which is the caller's bug, not the prover's.
#[wasm_bindgen]
pub fn verify_sign_in_proof(
    blob: &[u8],
    issuer: &str,
    origin: &str,
    aud: &str,
    nonce: &[u8],
    challenge: &[u8],
) -> Result<Object, JsError> {
    let nonce = array::<NONCE_LEN>(nonce, "the attempt nonce")?;
    let challenge = array::<NONCE_LEN>(challenge, "the attempt challenge")?;
    let out = Object::new();
    match verify_proof(blob, issuer, origin, aud, &nonce, &challenge) {
        Ok(proof) => {
            set(&out, "ok", true.into())?;
            let pk = Uint8Array::from(proof.identity.as_bytes().as_slice());
            set(&out, "identity_pk", pk.into())?;
        }
        Err(error) => {
            set(&out, "ok", false.into())?;
            set(&out, "reason", reason(&error).into())?;
            set(&out, "detail", error.to_string().into())?;
        }
    }
    Ok(out)
}

/// SHA3-256 (a code's at-rest key, and `SHA3-256(verifier) == challenge` at complete).
#[wasm_bindgen]
pub fn sha3_256(bytes: &[u8]) -> Vec<u8> {
    Sha3_256::digest(bytes).to_vec()
}
