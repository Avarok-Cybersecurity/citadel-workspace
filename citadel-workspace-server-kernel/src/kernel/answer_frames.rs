//! What the kernel sends back, in order, for one frame a connection sent.
//!
//! The answer frame is exactly what it always was. When the request named a `request_id`, it is
//! followed by `Answered { request_id, digest }` naming that answer frame's bytes
//! (citadel_workspace_types::request_frame), so the page pairs the answer with its request instead
//! of taking the next answer of a kind. A refusal before the request was read -- the rate limit, a
//! malformed frame -- is paired too when the frame's id can be read; an oversize frame is never
//! read, so its refusal goes unpaired. Broadcasts are sent elsewhere and are never paired.

use crate::kernel::async_kernel::AsyncWorkspaceServerKernel;
use crate::kernel::command_processor::async_process_command::process_command_with_user_and_cid;
use crate::kernel::documents::frame::{decode_request, FrameRefusal};
use citadel_logging::{error, warn};
use citadel_sdk::prelude::Ratchet;
use citadel_workspace_types::request_frame::{answer_digest, request_id_of, RequestFrame};
use citadel_workspace_types::{WorkspaceProtocolPayload, WorkspaceProtocolResponse};

pub(crate) const RATE_LIMITED: &str = "Rate limit exceeded. Please slow down.";

/// The frames to send for `frame`, from `user_id` on connection `cid`. `within_rate` is the
/// connection's rate limiter's verdict on this frame.
pub(crate) async fn frames_for<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    frame: &[u8],
    user_id: &str,
    cid: u64,
    within_rate: bool,
) -> Vec<Vec<u8>> {
    let max_frame = kernel
        .documents_relay()
        .map(|relay| relay.config.max_request_frame_bytes);
    let readable = max_frame.is_none_or(|max| frame.len() as u64 <= max);
    if !within_rate {
        warn!(target: "citadel", "[ASYNC_KERNEL] Rate limit exceeded for CID {cid}");
        let id = readable.then(|| request_id_of(frame)).flatten();
        return answered(WorkspaceProtocolResponse::Error(RATE_LIMITED.into()), id);
    }
    match decode_request(frame, max_frame) {
        Ok(RequestFrame {
            payload: WorkspaceProtocolPayload::Request(request),
            request_id,
        }) => {
            let response = process_command_with_user_and_cid(kernel, &request, user_id, Some(cid))
                .await
                .unwrap_or_else(|e| WorkspaceProtocolResponse::Error(e.to_string()));
            answered(response, request_id)
        }
        Ok(RequestFrame { payload, .. }) => {
            warn!(target: "citadel", "[ASYNC_KERNEL] Server received a WorkspaceProtocolPayload::Response when it expected a Request: {payload:?}");
            Vec::new()
        }
        Err(refusal) => {
            error!(target: "citadel", "[ASYNC_KERNEL] Refused a request frame: {refusal}. Message (first 50 bytes): {:?}", frame.iter().take(50).collect::<Vec<_>>());
            let id = match refusal {
                FrameRefusal::TooLarge { .. } => None,
                FrameRefusal::Malformed(_) => request_id_of(frame),
            };
            answered(WorkspaceProtocolResponse::Error(refusal.to_string()), id)
        }
    }
}

/// The answer frame, then, for a request that named an id, the frame pairing it.
fn answered(response: WorkspaceProtocolResponse, request_id: Option<u64>) -> Vec<Vec<u8>> {
    let Some(answer) = encode(response) else {
        return Vec::new();
    };
    let pairing = request_id.and_then(|request_id| {
        encode(WorkspaceProtocolResponse::Answered {
            request_id,
            digest: answer_digest(&answer),
        })
    });
    std::iter::once(answer).chain(pairing).collect()
}

fn encode(response: WorkspaceProtocolResponse) -> Option<Vec<u8>> {
    serde_json::to_vec(&WorkspaceProtocolPayload::Response(Box::new(response)))
        .inspect_err(|e| error!(target: "citadel", "[ASYNC_KERNEL] Failed to serialize response with serde_json: {e:?}"))
        .ok()
}
