//! The workspace protocol's answer to "what may this install reach from this member's machine":
//! the question the agent's host egress asks (citadel-internal-service's kernel/apps/net), and
//! the answers it reads off the session's link.
//!
//! Frames are `WorkspaceProtocolPayload` as JSON, the encoding the server kernel reads on every
//! C2S message, as telemetry/codec.rs's are.

use citadel_internal_service::{AuthoritySignal, HostNetAuthority, KernelGrant};
use citadel_workspace_types::apps_protocol::AppsRequest;
use citadel_workspace_types::apps_responses::AppsResponse;
use citadel_workspace_types::{
    WorkspaceProtocolPayload, WorkspaceProtocolRequest, WorkspaceProtocolResponse,
};

/// Every answer this reads names one of these keys; a frame without any is not parsed, so the
/// workspace traffic the agent forwards is not deserialised a second time.
const KEYS: [&[u8]; 8] = [
    b"\"HostNetGrant\"",
    b"\"InstallsChanged\"",
    b"\"Installed\"",
    b"\"Uninstalled\"",
    b"\"Updated\"",
    b"\"RolledBack\"",
    b"\"Consented\"",
    b"\"DisabledForMe\"",
];

pub struct WorkspaceHostNetAuthority;

fn names_a_key(frame: &[u8]) -> bool {
    KEYS.iter()
        .any(|key| frame.windows(key.len()).any(|w| w == *key))
}

impl HostNetAuthority for WorkspaceHostNetAuthority {
    fn grant_query(&self, install_id: &str, tag: u64) -> Result<Vec<u8>, String> {
        let request = WorkspaceProtocolRequest::Apps(AppsRequest::HostNetGrant {
            install_id: install_id.to_string(),
            tag,
        });
        serde_json::to_vec(&WorkspaceProtocolPayload::Request(request)).map_err(|e| e.to_string())
    }

    fn classify(&self, frame: &[u8]) -> AuthoritySignal {
        if !names_a_key(frame) {
            return AuthoritySignal::Unrelated;
        }
        let Ok(WorkspaceProtocolPayload::Response(response)) = serde_json::from_slice(frame) else {
            return AuthoritySignal::Unrelated;
        };
        let WorkspaceProtocolResponse::Apps(apps) = *response else {
            return AuthoritySignal::Unrelated;
        };
        match apps {
            AppsResponse::HostNetGrant {
                install_id,
                tag,
                grant,
            } => AuthoritySignal::Grant {
                install_id,
                tag,
                grant: grant.map(|g| KernelGrant {
                    app_id: g.app_id,
                    hosts: g.hosts,
                    private: g.private,
                }),
            },
            // What the server said about the member's installs may no longer hold.
            AppsResponse::InstallsChanged
            | AppsResponse::Installed { .. }
            | AppsResponse::Uninstalled { .. }
            | AppsResponse::Updated { .. }
            | AppsResponse::RolledBack { .. }
            | AppsResponse::Consented { .. }
            | AppsResponse::DisabledForMe { .. } => AuthoritySignal::InstallsChanged,
            _ => AuthoritySignal::Unrelated,
        }
    }
}

#[cfg(test)]
#[path = "apps_authority_tests.rs"]
mod tests;
