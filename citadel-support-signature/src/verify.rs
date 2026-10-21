//! What the signed formats share: the request body, the key, the refusals, and the check.
//!
//! A format is a signing domain and a payload type. Signing prefixes the payload's JSON text with
//! the domain; verifying checks the signature over the same bytes before the payload is parsed,
//! then its audience, nonce and lifetime. Neither format can be mistaken for the other because the
//! domains differ in their first bytes.

use ml_dsa::signature::{Keypair, Signer, Verifier};
use ml_dsa::VerifyingKey;
use ml_dsa::{EncodedSignature, EncodedVerifyingKey, MlDsa65, Seed, Signature, SigningKey};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use std::fmt;
use zeroize::Zeroize;

use crate::{
    MAX_LIFETIME_MS, MAX_PAYLOAD_BYTES, NONCE_LEN, PUBLIC_KEY_LEN, SEED_LEN, SIGNATURE_LEN,
};

/// The request body: the payload as the exact text that was signed, and the signature over it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SignedRequest {
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

impl Refusal {
    /// The refusal in words, naming the key by what it is for (`"support"`, `"admin"`).
    pub fn describe(&self, key: &str) -> String {
        match self {
            Self::MalformedKey(why) => format!("the {key} public key is malformed: {why}"),
            Self::MalformedSignature(why) => format!("the signature is malformed: {why}"),
            Self::MalformedRequest(why) => format!("the request is malformed: {why}"),
            Self::Invalid => format!("the signature does not verify against the {key} key"),
            Self::WrongAudience => "the request was made for another control plane".to_string(),
            Self::Expired => "the request has expired".to_string(),
            Self::LifetimeTooLong => format!(
                "the request expires more than {} seconds from now",
                MAX_LIFETIME_MS / 1000
            ),
        }
    }
}

/// Support's wording: the format this type was first written for.
impl fmt::Display for Refusal {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.describe("support"))
    }
}

impl std::error::Error for Refusal {}

/// The fields every payload carries, whatever it asks for.
pub trait Envelope {
    fn audience(&self) -> &str;
    fn nonce(&self) -> &str;
    fn expires_at_ms(&self) -> u64;
}

/// `expires_at_ms` for a request made at `now_ms` living `lifetime_ms` (at most `MAX_LIFETIME_MS`).
pub fn expiry(now_ms: u64, lifetime_ms: u64) -> Result<u64, Refusal> {
    if lifetime_ms == 0 || lifetime_ms > MAX_LIFETIME_MS {
        return Err(Refusal::LifetimeTooLong);
    }
    Ok(now_ms + lifetime_ms)
}

/// The bytes signed for `payload` under `domain`.
pub fn message(domain: &[u8], payload: &str) -> Vec<u8> {
    let mut message = Vec::with_capacity(domain.len() + payload.len());
    message.extend_from_slice(domain);
    message.extend_from_slice(payload.as_bytes());
    message
}

/// An ML-DSA-65 key expanded from its 32-byte seed, wiped on drop.
pub struct RequestSigningKey(SigningKey<MlDsa65>);

impl RequestSigningKey {
    pub fn from_seed(seed: &[u8; SEED_LEN]) -> Self {
        let mut xi = Seed::default();
        xi.copy_from_slice(seed);
        let key = SigningKey::<MlDsa65>::from_seed(&xi);
        xi.as_mut_slice().zeroize();
        Self(key)
    }

    /// The public key as the control plane's secret holds it: 3904 hex characters.
    pub fn public_key_hex(&self) -> String {
        hex::encode(self.0.verifying_key().encode().as_slice())
    }

    /// `request` signed under `domain`.
    pub fn seal<T: Serialize>(&self, domain: &[u8], request: &T) -> SignedRequest {
        let payload = serde_json::to_string(request).expect("a request serialises");
        let signature: Signature<MlDsa65> = self.0.sign(&message(domain, &payload));
        SignedRequest {
            payload,
            signature: hex::encode(signature.encode().as_slice()),
        }
    }
}

/// The payload `signed` carries under `domain`, if it is a valid one for `audience` at `now_ms`.
/// The nonce is the caller's to check for replay.
pub fn open<T: DeserializeOwned + Envelope>(
    domain: &[u8],
    public_key: &str,
    signed: &SignedRequest,
    audience: &str,
    now_ms: u64,
) -> Result<T, Refusal> {
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
    key.verify(&message(domain, &signed.payload), &signature)
        .map_err(|_| Refusal::Invalid)?;

    let request: T = serde_json::from_str(&signed.payload)
        .map_err(|e| Refusal::MalformedRequest(e.to_string()))?;
    if request.audience() != audience {
        return Err(Refusal::WrongAudience);
    }
    let nonce = request.nonce();
    let nonce_ok = nonce.len() == NONCE_LEN * 2
        && nonce
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b));
    if !nonce_ok {
        return Err(Refusal::MalformedRequest(format!(
            "the nonce is not {NONCE_LEN} bytes of lowercase hex"
        )));
    }
    let expires_at_ms = request.expires_at_ms();
    if expires_at_ms <= now_ms {
        return Err(Refusal::Expired);
    }
    if expires_at_ms - now_ms > MAX_LIFETIME_MS {
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
