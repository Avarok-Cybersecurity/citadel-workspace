//! The shipped agent's opt-in telemetry: the bounds of each session's ring, how often it is
//! uploaded, and the workspace protocol frames it travels in. The collector and uplink live
//! in the agent crate (citadel-internal-service/src/telemetry).

mod codec;

pub use codec::WorkspaceTelemetryCodec;

use citadel_internal_service::telemetry::{RingConfig, TelemetryCollector, TelemetryUplink};
use citadel_workspace_types::telemetry::MAX_TELEMETRY_BATCH_ENTRIES;
use std::sync::Arc;
use std::time::Duration;

/// How often each opted-in session's ring is uploaded.
pub const UPLOAD_INTERVAL: Duration = Duration::from_secs(5 * 60);
/// One full ring is one batch's worth of lines.
pub const RING_MAX_ENTRIES: usize = MAX_TELEMETRY_BATCH_ENTRIES;
/// Raw message and target bytes one ring holds; under one batch, so a full ring usually
/// uploads as one or two batches after the JSON around each line is added.
pub const RING_MAX_BYTES: usize = 192 * 1024;
/// Longest message or target kept from one line; the rest is cut.
pub const RING_MAX_MESSAGE_BYTES: usize = 2 * 1024;

/// The collector for the log layer and the uplink for the service, sharing one ring set.
pub fn build(
    agent_version: &str,
    os: &str,
) -> Result<(Arc<TelemetryCollector>, TelemetryUplink), String> {
    let ring = RingConfig::new(RING_MAX_ENTRIES, RING_MAX_BYTES, RING_MAX_MESSAGE_BYTES)
        .map_err(|err| err.to_string())?;
    let collector = TelemetryCollector::new(ring);
    let codec = Arc::new(WorkspaceTelemetryCodec::new(agent_version, os));
    let uplink = TelemetryUplink::new(collector.clone(), codec, UPLOAD_INTERVAL)?;
    Ok((collector, uplink))
}

#[cfg(test)]
mod tests;
