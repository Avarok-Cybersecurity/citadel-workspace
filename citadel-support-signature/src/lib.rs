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
//!
//! # The admin format
//!
//! [`AdminRequest`] (coupon issue, revoke and listing; plan `citadel-apps-and-coupons-design.md`
//! 1.6) is the same body and the same checks under its own domain, [`ADMIN_DOMAIN`], so a support
//! signature is never an admin one, or the reverse, even under the same key. The check itself
//! lives in `verify.rs`, which both formats share.

use citadel_workspace_types::telemetry::{TelemetryFilter, TelemetryPage};
use serde::{Deserialize, Serialize};

mod admin;
mod verify;

pub use admin::{
    admin_signed_message, verify_admin, AdminAction, AdminRequest, AdminSigningKey, CouponShape,
    SignedAdminRequest, ADMIN_DOMAIN,
};
use verify::Envelope;
pub use verify::{parse_public_key, Refusal, RequestSigningKey, SignedRequest};

// What the tests build requests and foreign-domain signatures with.
#[cfg(test)]
use ml_dsa::{signature::Signer, MlDsa65, Seed, Signature, SigningKey};

/// What every signed message starts with. Distinct from `citadel_release_signature::DOMAIN` and
/// from [`ADMIN_DOMAIN`].
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
pub type SignedSupportRequest = SignedRequest;

impl Envelope for SupportRequest {
    fn audience(&self) -> &str {
        &self.audience
    }
    fn nonce(&self) -> &str {
        &self.nonce
    }
    fn expires_at_ms(&self) -> u64 {
        self.expires_at_ms
    }
}

/// The bytes signed for `payload`.
pub fn signed_message(payload: &str) -> Vec<u8> {
    verify::message(DOMAIN, payload)
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
        Ok(Self {
            audience: audience.to_string(),
            nonce: hex::encode(nonce),
            expires_at_ms: verify::expiry(now_ms, lifetime_ms)?,
            action,
        })
    }
}

/// The support signing key: ML-DSA-65 expanded from its 32-byte seed, wiped on drop.
pub struct SupportSigningKey(RequestSigningKey);

impl SupportSigningKey {
    pub fn from_seed(seed: &[u8; SEED_LEN]) -> Self {
        Self(RequestSigningKey::from_seed(seed))
    }

    /// The public key as `CITADEL_SUPPORT_MLDSA_PUBLIC_KEY` holds it: 3904 hex characters.
    pub fn public_key_hex(&self) -> String {
        self.0.public_key_hex()
    }

    pub fn sign(&self, request: &SupportRequest) -> SignedSupportRequest {
        self.0.seal(DOMAIN, request)
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
    verify::open(DOMAIN, public_key, signed, audience, now_ms)
}

#[cfg(test)]
mod tests;
