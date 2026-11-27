//! A request frame, and the id that pairs it with its answer.
//!
//! The workspace protocol had no request id, so a page could only take "the next answer of kind
//! X" for its own, and a late answer to a request that had timed out was taken by the next one.
//! A page now names a request with `request_id` beside `Request`:
//!
//! ```json
//! {"request_id": 42, "Request": {...}}
//! ```
//!
//! and the kernel, after sending the answer frame exactly as before, sends
//! `Answered { request_id, digest }`, where `digest` is [`answer_digest`] of the answer frame's
//! bytes. The answer itself carries no id: an agent built before ids parses every frame strictly
//! and acts on the requester's own install answers, so the answer frame stays byte-for-byte what
//! it was. A page sends ids only to a kernel whose `ServerCapabilities.request_ids` says it reads
//! them; an older kernel refuses the extra key as a malformed frame.

use crate::WorkspaceProtocolPayload;
use serde::de::{self, MapAccess, Visitor};
use serde::{Deserialize, Deserializer};
use sha2::{Digest, Sha256};
use std::fmt;

/// The key a request frame names its id under.
pub const REQUEST_ID_KEY: &str = "request_id";

/// A decoded request frame: the payload, and the id the page named it with, if any.
#[derive(Debug, Clone)]
pub struct RequestFrame {
    pub payload: WorkspaceProtocolPayload,
    pub request_id: Option<u64>,
}

/// The digest an `Answered` frame names its answer by: lowercase hex SHA-256 of the answer
/// frame's bytes, exactly as sent (and, the agent forwarding them untouched, as the page gets them).
pub fn answer_digest(answer_frame: &[u8]) -> String {
    hex::encode(Sha256::digest(answer_frame))
}

/// Only the id of a frame that did not decode, so a refusal of it can still be paired with the
/// request. Every other key is skipped without being kept.
#[derive(Deserialize)]
struct IdOnly {
    #[serde(default)]
    request_id: Option<u64>,
}

/// The id a frame names, read without decoding the rest; `None` for a frame that names none or
/// is not JSON at all.
pub fn request_id_of(frame: &[u8]) -> Option<u64> {
    serde_json::from_slice::<IdOnly>(frame).ok()?.request_id
}

impl<'de> Deserialize<'de> for RequestFrame {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        deserializer.deserialize_map(FrameVisitor)
    }
}

struct FrameVisitor;

impl<'de> Visitor<'de> for FrameVisitor {
    type Value = RequestFrame;

    fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_str("a workspace protocol payload, with an optional request_id")
    }

    /// Streams the frame in any key order and keeps nothing but the payload and the id; any
    /// other key, or a second payload, is refused as the plain payload decoder would refuse it.
    fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<RequestFrame, A::Error> {
        let mut payload: Option<WorkspaceProtocolPayload> = None;
        let mut request_id: Option<u64> = None;
        while let Some(key) = map.next_key::<String>()? {
            let read = match key.as_str() {
                REQUEST_ID_KEY if request_id.is_none() => {
                    request_id = Some(map.next_value()?);
                    continue;
                }
                "Request" => WorkspaceProtocolPayload::Request(map.next_value()?),
                "Response" => WorkspaceProtocolPayload::Response(map.next_value()?),
                other => return Err(de::Error::custom(format!("unexpected key `{other}`"))),
            };
            if payload.replace(read).is_some() {
                return Err(de::Error::custom("a frame carries one payload"));
            }
        }
        let payload = payload.ok_or_else(|| de::Error::missing_field("Request"))?;
        Ok(RequestFrame {
            payload,
            request_id,
        })
    }
}
