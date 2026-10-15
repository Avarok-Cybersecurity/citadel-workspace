//! The signed request Avarok support sends the control plane to read a workspace's telemetry
//! (plan section 3): one definition of what is signed, shared by the signing tool
//! (`tools/telemetry-read`) and the verifier the control-plane Worker runs (`server-wasm`).
//!
//! # The wire format
//!
//! The request is POSTed as one JSON object, [`SignedSupportRequest`]:
//!
//! ```text
//! { "payload": "<SupportRequest as JSON text>", "signature": "<3309-byte ML-DSA-65 signature, hex>" }
//! ```
//!
//! The payload travels as the exact text that was signed, so nothing is re-serialised before it
//! is verified, and it is parsed only once its signature holds. The signed message is
//!
//! ```text
//! b"citadel-support-read-v1\0" || payload
//! ```
//!
//! ML-DSA-65 with an empty context string, as `citadel-release-signature` signs release assets.
//! The two domains differ in their first bytes, so a release signature is never a support
//! signature (or the reverse), even under the same key.
//!
//! # What is checked
//!
//! [`verify`] accepts a request only if the signature holds for the configured public key, the
//! `audience` is the control plane's own host, the `nonce` is 128 bits of hex, and `expires_at_ms`
//! is in the future by at most [`MAX_LIFETIME_MS`]. Refusing a replayed nonce needs state, which
//! the caller keeps (the control plane's D1 `support_nonces`).

use citadel_workspace_types::telemetry::{TelemetryFilter, TelemetryPage};
use ml_dsa::signature::{Keypair, Signer, Verifier};
use ml_dsa::VerifyingKey;
use ml_dsa::{EncodedSignature, EncodedVerifyingKey, MlDsa65, Seed, Signature, SigningKey};
use serde::{Deserialize, Serialize};
use std::fmt;
use zeroize::Zeroize;

/// What every signed message starts with. Distinct from `citadel_release_signature::DOMAIN`.
pub const DOMAIN: &[u8] = b"citadel-support-read-v1\0";
/// A request is valid for at most five minutes after it is made.
pub const MAX_LIFETIME_MS: u64 = 5 * 60 * 1000;
/// Bytes of randomness in a nonce; it is sent as twice as many lowercase hex characters.
pub const NONCE_LEN: usize = 16;
/// A payload is a few short fields; anything longer is refused before it is verified.
pub const MAX_PAYLOAD_BYTES: usize = 4096;
pub const SEED_LEN: usize = 32;
pub const PUBLIC_KEY_LEN: usize = 1952;
pub const SIGNATURE_LEN: usize = 3309;

/// What support asks for.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub enum SupportAction {
    /// The tenants whose admin has granted support access, and until when.
    ListGrants,
    /// One tenant's telemetry: the query its admins' `ListTelemetry` takes.
    FetchTelemetry {
        tenant: String,
        filter: TelemetryFilter,
        page: TelemetryPage,
    },
}

/// The signed payload.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SupportRequest {
    /// The control plane's host (`CONTROL_HOST`), so a request made for one deployment is refused
    /// by another.
    pub audience: String,
    /// `NONCE_LEN` random bytes in lowercase hex; the control plane serves each one once.
    pub nonce: String,
    /// Unix milliseconds.
    pub expires_at_ms: u64,
    pub action: SupportAction,
}

/// The request body.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SignedSupportRequest {
    pub payload: String,
    pub signature: String,
}

/// Why a request was not made or not accepted.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Refusal {
    MalformedKey(String),
    MalformedSignature(String),
    /// Not a payload this format defines (checked only after the signature holds).
    MalformedRequest(String),
    /// Well formed, and not this key's signature over this payload.
    Invalid,
    WrongAudience,
    Expired,
    /// Expires more than `MAX_LIFETIME_MS` after now.
    LifetimeTooLong,
}

impl fmt::Display for Refusal {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::MalformedKey(why) => write!(f, "the support public key is malformed: {why}"),
            Self::MalformedSignature(why) => write!(f, "the signature is malformed: {why}"),
            Self::MalformedRequest(why) => write!(f, "the request is malformed: {why}"),
            Self::Invalid => write!(f, "the signature does not verify against the support key"),
            Self::WrongAudience => write!(f, "the request was made for another control plane"),
            Self::Expired => write!(f, "the request has expired"),
            Self::LifetimeTooLong => write!(
                f,
                "the request expires more than {} seconds from now",
                MAX_LIFETIME_MS / 1000
            ),
        }
    }
}

impl std::error::Error for Refusal {}

/// The bytes signed for `payload`.
pub fn signed_message(payload: &str) -> Vec<u8> {
    let mut message = Vec::with_capacity(DOMAIN.len() + payload.len());
    message.extend_from_slice(DOMAIN);
    message.extend_from_slice(payload.as_bytes());
    message
}

impl SupportRequest {
    /// A request for `action`, valid from `now_ms` for `lifetime_ms` (at most `MAX_LIFETIME_MS`).
    pub fn new(
        audience: &str,
        action: SupportAction,
        nonce: &[u8; NONCE_LEN],
        now_ms: u64,
        lifetime_ms: u64,
    ) -> Result<Self, Refusal> {
        if lifetime_ms == 0 || lifetime_ms > MAX_LIFETIME_MS {
            return Err(Refusal::LifetimeTooLong);
        }
        Ok(Self {
            audience: audience.to_string(),
            nonce: hex::encode(nonce),
            expires_at_ms: now_ms + lifetime_ms,
            action,
        })
    }
}

/// The support signing key: ML-DSA-65 expanded from its 32-byte seed, wiped on drop.
pub struct SupportSigningKey(SigningKey<MlDsa65>);

impl SupportSigningKey {
    pub fn from_seed(seed: &[u8; SEED_LEN]) -> Self {
        let mut xi = Seed::default();
        xi.copy_from_slice(seed);
        let key = SigningKey::<MlDsa65>::from_seed(&xi);
        xi.as_mut_slice().zeroize();
        Self(key)
    }

    /// The public key as `CITADEL_SUPPORT_MLDSA_PUBLIC_KEY` holds it: 3904 hex characters.
    pub fn public_key_hex(&self) -> String {
        hex::encode(self.0.verifying_key().encode().as_slice())
    }

    pub fn sign(&self, request: &SupportRequest) -> SignedSupportRequest {
        let payload = serde_json::to_string(request).expect("a SupportRequest serialises");
        let signature: Signature<MlDsa65> = self.0.sign(&signed_message(&payload));
        SignedSupportRequest {
            payload,
            signature: hex::encode(signature.encode().as_slice()),
        }
    }
}

/// The request `signed` carries, if it is a valid one for `audience` at `now_ms` (see the module
/// docs). The nonce is the caller's to check for replay.
pub fn verify(
    public_key: &str,
    signed: &SignedSupportRequest,
    audience: &str,
    now_ms: u64,
) -> Result<SupportRequest, Refusal> {
    let key = parse_public_key(public_key)?;
    if signed.payload.len() > MAX_PAYLOAD_BYTES {
        return Err(Refusal::MalformedRequest(format!(
            "the payload is over {MAX_PAYLOAD_BYTES} bytes"
        )));
    }
    let bytes =
        decode_exact::<SIGNATURE_LEN>(&signed.signature).map_err(Refusal::MalformedSignature)?;
    let encoded = EncodedSignature::<MlDsa65>::try_from(&bytes[..])
        .map_err(|_| Refusal::MalformedSignature("not an ML-DSA-65 signature".to_string()))?;
    let signature = Signature::<MlDsa65>::decode(&encoded)
        .ok_or_else(|| Refusal::MalformedSignature("it does not decode".to_string()))?;
    key.verify(&signed_message(&signed.payload), &signature)
        .map_err(|_| Refusal::Invalid)?;

    let request: SupportRequest = serde_json::from_str(&signed.payload)
        .map_err(|e| Refusal::MalformedRequest(e.to_string()))?;
    if request.audience != audience {
        return Err(Refusal::WrongAudience);
    }
    let nonce_ok = request.nonce.len() == NONCE_LEN * 2
        && request
            .nonce
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b));
    if !nonce_ok {
        return Err(Refusal::MalformedRequest(format!(
            "the nonce is not {NONCE_LEN} bytes of lowercase hex"
        )));
    }
    if request.expires_at_ms <= now_ms {
        return Err(Refusal::Expired);
    }
    if request.expires_at_ms - now_ms > MAX_LIFETIME_MS {
        return Err(Refusal::LifetimeTooLong);
    }
    Ok(request)
}

/// The configured public key: exactly 1952 bytes of hex, surrounding whitespace ignored.
pub fn parse_public_key(text: &str) -> Result<VerifyingKey<MlDsa65>, Refusal> {
    let bytes = decode_exact::<PUBLIC_KEY_LEN>(text.trim()).map_err(Refusal::MalformedKey)?;
    let encoded = EncodedVerifyingKey::<MlDsa65>::try_from(&bytes[..])
        .map_err(|_| Refusal::MalformedKey("not an ML-DSA-65 key".to_string()))?;
    Ok(VerifyingKey::<MlDsa65>::decode(&encoded))
}

fn decode_exact<const N: usize>(text: &str) -> Result<[u8; N], String> {
    if text.len() != N * 2 {
        return Err(format!(
            "{} hex characters, not the {} of {N} bytes",
            text.len(),
            N * 2
        ));
    }
    let mut out = [0u8; N];
    hex::decode_to_slice(text, &mut out).map_err(|e| e.to_string())?;
    Ok(out)
}

#[cfg(test)]
mod tests;
