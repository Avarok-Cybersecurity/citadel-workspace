//! The workspace protocol's telemetry frames: what the agent's uplink sends and reads.
//!
//! Frames are `WorkspaceProtocolPayload` as JSON, the encoding the server kernel reads on
//! every C2S message (citadel-workspace-server-kernel/src/kernel/async_kernel.rs).

use citadel_internal_service::telemetry::{
    ServerSignal, TelemetryCodec, TelemetryEntry as AgentEntry, TelemetryLevel as AgentLevel,
};
use citadel_workspace_types::telemetry::{
    TelemetryBatch, TelemetryEntry, TelemetryLevel, TelemetryRequest, TelemetryResponse,
    MAX_TELEMETRY_BATCH_BYTES, MAX_TELEMETRY_BATCH_ENTRIES, TELEMETRY_BATCH_FORMAT_VERSION,
};
use citadel_workspace_types::{
    WorkspaceProtocolPayload, WorkspaceProtocolRequest, WorkspaceProtocolResponse,
};

/// Every telemetry answer names this key; a frame without it is not parsed at all, so the
/// workspace traffic the agent forwards is not deserialised a second time.
const TELEMETRY_KEY: &[u8] = b"\"Telemetry\"";

pub struct WorkspaceTelemetryCodec {
    agent_version: String,
    os: String,
}

impl WorkspaceTelemetryCodec {
    pub fn new(agent_version: &str, os: &str) -> Self {
        Self {
            agent_version: agent_version.to_owned(),
            os: os.to_owned(),
        }
    }

    fn frame(&self, entries: Vec<TelemetryEntry>) -> Result<Vec<u8>, String> {
        let batch = TelemetryBatch {
            format_version: TELEMETRY_BATCH_FORMAT_VERSION,
            agent_version: self.agent_version.clone(),
            os: self.os.clone(),
            entries,
        };
        encode(WorkspaceProtocolRequest::Telemetry(
            TelemetryRequest::UploadTelemetry { batch },
        ))
    }

    /// Greedy split: a frame closes when the next entry would pass the entry or byte limit.
    /// Sizes are measured on the whole frame, a superset of the batch the server measures.
    pub fn split(&self, entries: Vec<TelemetryEntry>) -> Result<Vec<Vec<u8>>, String> {
        let empty = self.frame(Vec::new())?.len();
        let mut frames = Vec::new();
        let mut current: Vec<TelemetryEntry> = Vec::new();
        let mut size = empty;
        for entry in entries {
            let len = serde_json::to_vec(&entry).map_err(|e| e.to_string())?.len();
            if empty + len > MAX_TELEMETRY_BATCH_BYTES {
                return Err(format!(
                    "one telemetry entry of {len} bytes exceeds a batch"
                ));
            }
            let separator = usize::from(!current.is_empty());
            if current.len() == MAX_TELEMETRY_BATCH_ENTRIES
                || size + separator + len > MAX_TELEMETRY_BATCH_BYTES
            {
                frames.push(self.frame(std::mem::take(&mut current))?);
                size = empty;
            }
            size += usize::from(!current.is_empty()) + len;
            current.push(entry);
        }
        if !current.is_empty() {
            frames.push(self.frame(current)?);
        }
        match frames.iter().find(|f| f.len() > MAX_TELEMETRY_BATCH_BYTES) {
            Some(over) => Err(format!("a telemetry frame came to {} bytes", over.len())),
            None => Ok(frames),
        }
    }
}

fn encode(request: WorkspaceProtocolRequest) -> Result<Vec<u8>, String> {
    serde_json::to_vec(&WorkspaceProtocolPayload::Request(request)).map_err(|e| e.to_string())
}

fn wire_entry(entry: AgentEntry) -> TelemetryEntry {
    TelemetryEntry {
        time_ms: entry.time_ms,
        level: match entry.level {
            AgentLevel::Warn => TelemetryLevel::Warn,
            AgentLevel::Error => TelemetryLevel::Error,
        },
        target: entry.target,
        message: entry.message,
        peer_cid: entry.peer_cid,
    }
}

impl TelemetryCodec for WorkspaceTelemetryCodec {
    fn consent_query(&self) -> Result<Vec<u8>, String> {
        encode(WorkspaceProtocolRequest::Telemetry(
            TelemetryRequest::GetMyConsent,
        ))
    }

    fn upload_frames(&self, entries: Vec<AgentEntry>) -> Result<Vec<Vec<u8>>, String> {
        self.split(entries.into_iter().map(wire_entry).collect())
    }

    fn classify(&self, frame: &[u8]) -> ServerSignal {
        if !frame
            .windows(TELEMETRY_KEY.len())
            .any(|w| w == TELEMETRY_KEY)
        {
            return ServerSignal::Unrelated;
        }
        let Ok(WorkspaceProtocolPayload::Response(response)) = serde_json::from_slice(frame) else {
            return ServerSignal::Unrelated;
        };
        match *response {
            WorkspaceProtocolResponse::Telemetry(TelemetryResponse::Consent(consent)) => {
                ServerSignal::Consent {
                    uploads_allowed: consent.uploads_allowed,
                }
            }
            WorkspaceProtocolResponse::Telemetry(TelemetryResponse::Uploaded { .. }) => {
                ServerSignal::UploadStored
            }
            WorkspaceProtocolResponse::Telemetry(TelemetryResponse::UploadRefused(_)) => {
                ServerSignal::UploadRefused
            }
            _ => ServerSignal::Unrelated,
        }
    }
}
