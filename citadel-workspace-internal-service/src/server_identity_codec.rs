//! The workspace protocol's encoding of the agent's post-connect `ServerIdentityChallenge` and
//! the kernel's `ServerIdentity` answer (contract `server-identity-challenge.md` §1), for the
//! agent's portable identity (citadel-internal-service's kernel/identity/challenge.rs).
//!
//! Frames are `WorkspaceProtocolPayload` as JSON, the encoding the server kernel reads on every
//! C2S message, as apps_authority.rs's are.

use citadel_internal_service::kernel::identity::{ServerIdentityAnswer, ServerIdentityCodec};
use citadel_workspace_types::server_identity::{
    ServerIdentityChallenge, SERVER_IDENTITY_NONCE_LEN,
};
use citadel_workspace_types::{
    WorkspaceProtocolPayload, WorkspaceProtocolRequest, WorkspaceProtocolResponse,
};

/// Every answer names this key; a frame without it is not parsed, so the workspace traffic the
/// agent forwards is not deserialised a second time. The closing quote keeps the request
/// (`"ServerIdentityChallenge"`) out.
const KEY: &[u8] = b"\"ServerIdentity\"";

pub struct WorkspaceServerIdentityCodec;

impl ServerIdentityCodec for WorkspaceServerIdentityCodec {
    // The trait's `citadel_identity::NONCE_LEN` and the wire's length are one number: were they
    // to differ, this signature would not match the trait's and the crate would not build.
    fn challenge(&self, nonce: &[u8; SERVER_IDENTITY_NONCE_LEN]) -> Result<Vec<u8>, String> {
        let request = WorkspaceProtocolRequest::ServerIdentityChallenge(ServerIdentityChallenge {
            nonce: *nonce,
        });
        serde_json::to_vec(&WorkspaceProtocolPayload::Request(request)).map_err(|e| e.to_string())
    }

    fn answer(&self, frame: &[u8]) -> Option<ServerIdentityAnswer> {
        if !frame.windows(KEY.len()).any(|w| w == KEY) {
            return None;
        }
        let WorkspaceProtocolPayload::Response(response) = serde_json::from_slice(frame).ok()?
        else {
            return None;
        };
        let WorkspaceProtocolResponse::ServerIdentity(answer) = *response else {
            return None;
        };
        Some(ServerIdentityAnswer {
            domain: answer.domain,
            pk: answer.pk,
            sig: answer.sig,
        })
    }
}

#[cfg(test)]
#[path = "server_identity_codec_tests.rs"]
mod tests;
