//! The first thing done with a request frame: refuse one longer than `max_request_frame_bytes`
//! before parsing it, so an oversize payload is never decoded into memory, then parse it.
//!
//! The per-field caps (`max_update_bytes` and the rest) are checked after decoding, where the
//! field is known; this bounds what decoding can be asked to allocate at all.

use citadel_workspace_types::WorkspaceProtocolPayload;

#[derive(Debug)]
pub enum FrameRefusal {
    TooLarge { size_bytes: usize, max_bytes: u64 },
    Malformed(serde_json::Error),
}

impl std::fmt::Display for FrameRefusal {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::TooLarge {
                size_bytes,
                max_bytes,
            } => write!(
                f,
                "Request too large: {size_bytes} bytes, at most {max_bytes}. It was not read."
            ),
            Self::Malformed(e) => {
                write!(f, "Invalid command. Failed serde_json deserialization: {e}")
            }
        }
    }
}

/// `max_bytes` is the documents relay's `max_request_frame_bytes`; `None` only for a kernel
/// built without a relay, which a server never is (`resolve_documents_relay`).
pub fn decode_request(
    frame: &[u8],
    max_bytes: Option<u64>,
) -> Result<WorkspaceProtocolPayload, FrameRefusal> {
    if let Some(max_bytes) = max_bytes {
        if frame.len() as u64 > max_bytes {
            return Err(FrameRefusal::TooLarge {
                size_bytes: frame.len(),
                max_bytes,
            });
        }
    }
    serde_json::from_slice(frame).map_err(FrameRefusal::Malformed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_oversize_frame_is_refused_before_it_is_parsed() {
        // Not JSON at all: were it parsed first, the answer would be Malformed.
        let garbage = vec![b'['; 65];
        assert!(matches!(
            decode_request(&garbage, Some(64)),
            Err(FrameRefusal::TooLarge {
                size_bytes: 65,
                max_bytes: 64
            })
        ));
        assert!(matches!(
            decode_request(&garbage[..64], Some(64)),
            Err(FrameRefusal::Malformed(_))
        ));
    }

    #[test]
    fn a_frame_within_the_cap_is_parsed() {
        let frame = serde_json::to_vec(&WorkspaceProtocolPayload::Request(
            citadel_workspace_types::WorkspaceProtocolRequest::ListMembers { domain_id: None },
        ))
        .expect("encode");
        let max = frame.len() as u64;
        assert!(decode_request(&frame, Some(max)).is_ok());
        assert!(matches!(
            decode_request(&frame, Some(max - 1)),
            Err(FrameRefusal::TooLarge { .. })
        ));
    }
}
