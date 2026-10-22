//! The signed request the owner's `tools/coupon-admin` sends the control plane to issue, revoke
//! and list dynamic coupons (`docs/plans/citadel-apps-and-coupons-design.md` 1.6).
//!
//! The body is a [`SignedAdminRequest`] (`{ payload, signature }`, as support's), the signed
//! message is `ADMIN_DOMAIN || payload`, and [`verify_admin`] runs the same checks as support's
//! `verify`: the signature first, then audience, nonce and lifetime. Only the domain and the
//! payload type differ, so an admin key and a support key may even be one key without a support
//! read ever passing as a coupon issue.
//!
//! Which coupon shapes exist, which tiers they apply to and whether a grant is unlimited are the
//! control plane's to judge against `billing/tiers.json`; this format only carries the request.

use crate::verify::{self, Envelope, RequestSigningKey, SignedRequest};
use crate::{Refusal, NONCE_LEN, SEED_LEN};
use serde::{Deserialize, Serialize};

/// What every signed admin message starts with. Distinct from support's `DOMAIN` and from
/// `citadel_release_signature::DOMAIN`.
pub const ADMIN_DOMAIN: &[u8] = b"citadel-control-admin-v1\0";

/// What a coupon is an instance of: a `tiers.json` `coupons.templates[]` id (a discount or a
/// trial) or a `coupons.grants[]` id (a comp grant). On the wire it is the action's `template`
/// and `grant_id` fields, both stated, exactly one of them null.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CouponShape {
    Template(String),
    Grant(String),
}

/// What the owner asks for. Serialized as [`WireAction`]: `{ kind, ...fields }`, the shape
/// `deploy/tenant-worker/control/coupon-admin-payload.mjs` reads field for field.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(into = "WireAction", try_from = "WireAction")]
pub enum AdminAction {
    /// A new dynamic code. Every field is required, `redeem_by_ms` included (`null` is "no
    /// deadline", which the control plane refuses for an unlimited grant).
    IssueCoupon {
        code: String,
        shape: CouponShape,
        /// Paid tier ids the code applies to.
        available_on: Vec<String>,
        /// Billing intervals (`month`, `year`) the code applies to.
        intervals: Vec<String>,
        max_redemptions: u32,
        /// Unix milliseconds after which the code redeems no more.
        redeem_by_ms: Option<u64>,
        note: String,
    },
    /// Stop a code redeeming. `also_revoke_grants` must be stated each time: whether tenants that
    /// already redeemed a grant with it lose it too.
    RevokeCoupon {
        code: String,
        also_revoke_grants: bool,
    },
    ListCoupons,
    ListRedemptions {
        code: String,
    },
}

/// [`AdminAction`] as it is signed: internally tagged by `kind`, every field required (an
/// `Option` is stated as `null`, never left out), nothing unknown, and a field-less action an
/// empty struct so that it too refuses an unknown field.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum WireAction {
    IssueCoupon {
        code: String,
        #[serde(deserialize_with = "Option::deserialize")]
        template: Option<String>,
        #[serde(deserialize_with = "Option::deserialize")]
        grant_id: Option<String>,
        available_on: Vec<String>,
        intervals: Vec<String>,
        max_redemptions: u32,
        #[serde(deserialize_with = "Option::deserialize")]
        redeem_by_ms: Option<u64>,
        note: String,
    },
    RevokeCoupon {
        code: String,
        also_revoke_grants: bool,
    },
    ListCoupons {},
    ListRedemptions {
        code: String,
    },
}

impl From<AdminAction> for WireAction {
    fn from(action: AdminAction) -> Self {
        match action {
            AdminAction::IssueCoupon {
                code,
                shape,
                available_on,
                intervals,
                max_redemptions,
                redeem_by_ms,
                note,
            } => {
                let (template, grant_id) = match shape {
                    CouponShape::Template(id) => (Some(id), None),
                    CouponShape::Grant(id) => (None, Some(id)),
                };
                WireAction::IssueCoupon {
                    code,
                    template,
                    grant_id,
                    available_on,
                    intervals,
                    max_redemptions,
                    redeem_by_ms,
                    note,
                }
            }
            AdminAction::RevokeCoupon {
                code,
                also_revoke_grants,
            } => WireAction::RevokeCoupon {
                code,
                also_revoke_grants,
            },
            AdminAction::ListCoupons => WireAction::ListCoupons {},
            AdminAction::ListRedemptions { code } => WireAction::ListRedemptions { code },
        }
    }
}

impl TryFrom<WireAction> for AdminAction {
    type Error = String;

    fn try_from(wire: WireAction) -> Result<Self, Self::Error> {
        Ok(match wire {
            WireAction::IssueCoupon {
                code,
                template,
                grant_id,
                available_on,
                intervals,
                max_redemptions,
                redeem_by_ms,
                note,
            } => AdminAction::IssueCoupon {
                code,
                shape: match (template, grant_id) {
                    (Some(id), None) => CouponShape::Template(id),
                    (None, Some(id)) => CouponShape::Grant(id),
                    _ => return Err("an issue names exactly one of template and grant_id".into()),
                },
                available_on,
                intervals,
                max_redemptions,
                redeem_by_ms,
                note,
            },
            WireAction::RevokeCoupon {
                code,
                also_revoke_grants,
            } => AdminAction::RevokeCoupon {
                code,
                also_revoke_grants,
            },
            WireAction::ListCoupons {} => AdminAction::ListCoupons,
            WireAction::ListRedemptions { code } => AdminAction::ListRedemptions { code },
        })
    }
}

/// The signed payload.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AdminRequest {
    /// The control plane's host (`CONTROL_HOST`).
    pub audience: String,
    /// `NONCE_LEN` random bytes in lowercase hex; the control plane serves each one once.
    pub nonce: String,
    /// Unix milliseconds.
    pub expires_at_ms: u64,
    pub action: AdminAction,
}

/// The request body: the same shape as support's.
pub type SignedAdminRequest = SignedRequest;

impl Envelope for AdminRequest {
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

impl AdminRequest {
    /// A request for `action`, valid from `now_ms` for `lifetime_ms` (at most `MAX_LIFETIME_MS`).
    pub fn new(
        audience: &str,
        action: AdminAction,
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

/// The bytes signed for an admin `payload`.
pub fn admin_signed_message(payload: &str) -> Vec<u8> {
    verify::message(ADMIN_DOMAIN, payload)
}

/// The admin signing key: ML-DSA-65 expanded from its 32-byte seed, wiped on drop.
pub struct AdminSigningKey(RequestSigningKey);

impl AdminSigningKey {
    pub fn from_seed(seed: &[u8; SEED_LEN]) -> Self {
        Self(RequestSigningKey::from_seed(seed))
    }

    /// The public key as `CITADEL_ADMIN_MLDSA_PUBLIC_KEY` holds it: 3904 hex characters.
    pub fn public_key_hex(&self) -> String {
        self.0.public_key_hex()
    }

    pub fn sign(&self, request: &AdminRequest) -> SignedAdminRequest {
        self.0.seal(ADMIN_DOMAIN, request)
    }
}

/// The admin request `signed` carries, if it is a valid one for `audience` at `now_ms`. The nonce
/// is the caller's to check for replay. Refusals read best as `refusal.describe("admin")`.
pub fn verify_admin(
    public_key: &str,
    signed: &SignedAdminRequest,
    audience: &str,
    now_ms: u64,
) -> Result<AdminRequest, Refusal> {
    verify::open(ADMIN_DOMAIN, public_key, signed, audience, now_ms)
}

#[cfg(test)]
mod field_tests;
#[cfg(test)]
mod tests;
