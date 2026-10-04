//! A census of a tenant's accounts by auth-record version, read without loading them.
//!
//! An account row's `bin` is the SDK's bincode of its account record, whose `auth_store` field is
//! an append-only enum: the variant index is the record's version (0 legacy Argon2, 1 transient,
//! 2 post-quantum). The SDK's loader cannot be the reader: once Argon2 is retired it refuses a
//! version-0 record, which would turn the very accounts being counted into "undecodable".
//! So the record's leading fields are read with the SDK's own types and options
//! (its bincode options), and the enum is
//! read as its tag alone, never its payload: the count is the same before and after the sunset.
//!
//! Counts only. The prefix read here carries a username and a CID in places; none is returned.

use bincode::Options;
use citadel_crypt::endpoint_crypto_container::PeerSessionCrypto;
use citadel_sdk::prelude::StackedRatchet;
use citadel_user::prelude::ConnectionInfo;
use serde::de::{Deserializer, EnumAccess, Visitor};
use serde::Deserialize;
use std::fmt;

/// Accounts by stored auth-record version. `undecodable` is a row whose record could not be read
/// as far as its version, or whose version this build does not know.
#[derive(Debug, Default, PartialEq, Eq, Clone, Copy)]
pub struct AuthVersions {
    pub legacy_argon: u32,
    pub transient: u32,
    pub post_quantum: u32,
    pub undecodable: u32,
}

const LEGACY_ARGON: u32 = 0;
const TRANSIENT: u32 = 1;
const POST_QUANTUM: u32 = 2;

/// The version tag of an enum, read as the tag alone.
struct Version(u32);

impl<'de> Deserialize<'de> for Version {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct Tag;
        impl<'de> Visitor<'de> for Tag {
            type Value = Version;
            fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
                f.write_str("an auth-record version")
            }
            fn visit_enum<A: EnumAccess<'de>>(self, data: A) -> Result<Version, A::Error> {
                let (tag, _payload): (u32, _) = data.variant()?;
                Ok(Version(tag))
            }
        }
        deserializer.deserialize_enum("AuthRecordVersion", &[], Tag)
    }
}

/// The SDK's account record up to and including `auth_store` (client_account.rs, field for field;
/// the tests decode records the SDK itself wrote, so a drifted layout fails there).
#[derive(Deserialize)]
#[allow(dead_code)]
struct AccountPrefix {
    cid: u64,
    is_personal: bool,
    is_transient: bool,
    creation_date: String,
    adjacent_nac: ConnectionInfo,
    crypto_session_state: Option<PeerSessionCrypto<StackedRatchet>>,
    auth_version: Version,
}

/// The version of one stored account record, or `None` when it cannot be read that far.
fn version_of(bin: &[u8]) -> Option<u32> {
    // The SDK's own options (citadel_user serialization.rs `limited_options`): fixint, trailing
    // bytes allowed (the prefix is not the whole record), allocations capped at the input.
    bincode::DefaultOptions::new()
        .with_fixint_encoding()
        .allow_trailing_bytes()
        .with_limit(bin.len() as u64)
        .deserialize::<AccountPrefix>(bin)
        .ok()
        .map(|prefix| prefix.auth_version.0)
}

/// Counts the records by version.
pub fn count<'a>(blobs: impl IntoIterator<Item = &'a [u8]>) -> AuthVersions {
    let mut counts = AuthVersions::default();
    for bin in blobs {
        let slot = match version_of(bin) {
            Some(LEGACY_ARGON) => &mut counts.legacy_argon,
            Some(TRANSIENT) => &mut counts.transient,
            Some(POST_QUANTUM) => &mut counts.post_quantum,
            _ => &mut counts.undecodable,
        };
        *slot += 1;
    }
    counts
}
