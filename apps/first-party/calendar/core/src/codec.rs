//! Every stored Calendar value, CBOR through the SDK's codec, versioned `v: 1` (design §3.3.2).
//! A value of a version this build does not know is refused, never guessed at: a reader that
//! cannot place a value says so (design §3.4).

use crate::model::Event;
use alloc::string::String;
use alloc::vec::Vec;
use citadel_app_sdk_types::{decode, encode};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};

/// The version this build writes and reads.
pub const VERSION: u8 = 1;

/// The largest stored event (design §3.3.2): a body is text, not a document.
pub const EVENT_MAX_BYTES: usize = 8 * 1024;

#[derive(Serialize, Deserialize)]
struct Stored<T> {
    v: u8,
    value: T,
}

#[derive(Deserialize)]
struct VersionOnly {
    v: u8,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CodecError {
    /// Not CBOR, or not this type.
    Malformed(String),
    /// Written by a version this build does not read.
    UnknownVersion(u8),
    /// Larger than the type's stored bound.
    TooLarge { bytes: usize, max: usize },
}

pub fn to_bytes<T: Serialize>(value: &T) -> Vec<u8> {
    encode(&Stored { v: VERSION, value })
}

pub fn from_bytes<T: DeserializeOwned>(bytes: &[u8]) -> Result<T, CodecError> {
    // The version is read first, alone, so a newer value is "unknown version", not "malformed".
    let version: VersionOnly = decode(bytes).map_err(|e| CodecError::Malformed(e.0))?;
    if version.v != VERSION {
        return Err(CodecError::UnknownVersion(version.v));
    }
    let stored: Stored<T> = decode(bytes).map_err(|e| CodecError::Malformed(e.0))?;
    Ok(stored.value)
}

/// An event's stored bytes, refused past `EVENT_MAX_BYTES`.
pub fn event_to_bytes(event: &Event) -> Result<Vec<u8>, CodecError> {
    let bytes = to_bytes(event);
    if bytes.len() > EVENT_MAX_BYTES {
        return Err(CodecError::TooLarge {
            bytes: bytes.len(),
            max: EVENT_MAX_BYTES,
        });
    }
    Ok(bytes)
}
