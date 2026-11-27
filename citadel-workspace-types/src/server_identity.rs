//! The post-connect server identity challenge (contract `server-identity-challenge.md` §1).
//!
//! A member's agent sends a fresh nonce; the kernel answers with its canonical domain, its
//! ML-DSA-65 key and a signature over `nonce ‖ cid ‖ domain`, where `cid` is the session's own
//! CID as the server knows it, never a value the client sends. The agent checks the answer
//! against the key it pinned, so a server holding another key is noticed before any data is
//! trusted. Both shapes refuse unknown fields: nothing unsigned rides along.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// The nonce's length, fixed by the contract (`citadel_identity::NONCE_LEN`).
pub const SERVER_IDENTITY_NONCE_LEN: usize = 32;

/// `WorkspaceProtocolRequest::ServerIdentityChallenge`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
#[ts(export)]
pub struct ServerIdentityChallenge {
    /// Exactly 32 bytes on the wire (a longer or shorter array is refused).
    #[ts(type = "Array<number>")]
    pub nonce: [u8; SERVER_IDENTITY_NONCE_LEN],
}

/// `WorkspaceProtocolResponse::ServerIdentity`: the server's canonical domain, its public key
/// (1952 bytes) and the signature (3309 bytes) over the challenge.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
#[ts(export)]
pub struct ServerIdentity {
    pub domain: String,
    #[ts(type = "Uint8Array")]
    #[serde(with = "citadel_internal_service_types::wire_bytes")]
    pub pk: Vec<u8>,
    #[ts(type = "Uint8Array")]
    #[serde(with = "citadel_internal_service_types::wire_bytes")]
    pub sig: Vec<u8>,
}

/// By length: every response is debug-logged, and the key and signature are kilobytes.
impl std::fmt::Debug for ServerIdentity {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "ServerIdentity {{ domain: {:?}, pk: <{} bytes>, sig: <{} bytes> }}",
            self.domain,
            self.pk.len(),
            self.sig.len()
        )
    }
}
