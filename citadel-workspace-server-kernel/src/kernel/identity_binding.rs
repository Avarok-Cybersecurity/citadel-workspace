//! `UpdateUserProfile.identity_binding`: the user's portable identity signing that it holds this
//! account on this server (identity doc §3.4/§6 rev b). Servers verify, clients compute: the
//! kernel stores a binding only once it is the actor's own, names one of this server's domains,
//! is not from the future, is newer than the one stored, and its ML-DSA-65 signature verifies.
//! Every member may then read it (`profile_update::MEMBER_VISIBLE_KEYS`), stranger or not.
//!
//! Pure: the caller holds the user lock and passes the stored binding and the clock.

use citadel_identity::{binding_from_base64url, verify_binding, CanonicalDomain, BINDING_VERSION};

/// The stored binding's text under `User.metadata`.
pub const IDENTITY_BINDING_KEY: &str = "identity_binding";

/// What a binding write is checked against: this server's domains and its clock.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BindingWrite {
    pub blob_base64url: String,
    pub accepted: Vec<CanonicalDomain>,
    pub now_s: u64,
}

/// `issued_at` of a stored blob: `version ‖ u64be(issued_at) ‖ …` (identity-api.md §5). The
/// stored blob verified when it was written; only its time is needed to keep writes monotonic.
fn stored_issued_at(stored_base64url: &str) -> Result<u64, String> {
    let blob = binding_from_base64url(stored_base64url).map_err(|e| e.to_string())?;
    match blob.get(..9) {
        Some([version, at @ ..]) if *version == BINDING_VERSION => {
            let at: [u8; 8] = at.try_into().map_err(|_| "short binding".to_string())?;
            Ok(u64::from_be_bytes(at))
        }
        _ => Err("the stored identity binding is not a version 2 binding".to_string()),
    }
}

/// Whether `write` may replace `stored` as `actor`'s binding, or why not.
pub fn check_binding_write(
    write: &BindingWrite,
    actor: &str,
    stored: Option<&str>,
) -> Result<(), String> {
    let blob = binding_from_base64url(&write.blob_base64url).map_err(|e| e.to_string())?;
    let verified =
        verify_binding(&blob, actor, &write.accepted, write.now_s).map_err(|e| e.to_string())?;
    if let Some(stored) = stored {
        let previous = stored_issued_at(stored)?;
        if verified.issued_at_s <= previous {
            return Err(format!(
                "the identity binding was issued at {}, not after the stored one ({previous}): \
                 a replay or a rollback",
                verified.issued_at_s
            ));
        }
    }
    Ok(())
}
