//! The `cal` topic's payload (Calendar design §3.5): which key on which node changed, and
//! nothing else. A receiver reads the key again with its own rights; a message that carries any
//! other field (a title, a body) is refused, so a topic can never become a side channel for
//! event content.

use alloc::string::String;
use alloc::vec::Vec;
use citadel_app_sdk_types::{decode, encode};
use serde::{Deserialize, Serialize};

/// The manifest's `topics.max_msg_bytes` for `cal`.
pub const TOPIC_MAX_BYTES: usize = 1024;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
#[serde(deny_unknown_fields)]
pub struct CalChange {
    pub node: String,
    pub key: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TopicError {
    TooLarge,
    /// Not exactly a `CalChange`.
    Refused,
}

pub fn encode_change(change: &CalChange) -> Result<Vec<u8>, TopicError> {
    let bytes = encode(change);
    if bytes.len() > TOPIC_MAX_BYTES {
        return Err(TopicError::TooLarge);
    }
    Ok(bytes)
}

pub fn decode_change(bytes: &[u8]) -> Result<CalChange, TopicError> {
    if bytes.len() > TOPIC_MAX_BYTES {
        return Err(TopicError::TooLarge);
    }
    decode(bytes).map_err(|_| TopicError::Refused)
}
