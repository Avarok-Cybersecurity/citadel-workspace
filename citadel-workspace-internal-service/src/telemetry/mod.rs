//! The shipped agent's opt-in telemetry: the bounds of each session's ring, how often it is
//! uploaded, how much of a window's console it takes, and the workspace protocol frames it
//! travels in. The collector and uplink live in the agent crate
//! (citadel-internal-service/src/telemetry).

mod codec;

pub use codec::WorkspaceTelemetryCodec;

use citadel_internal_service::telemetry::{
    BrowserLimits, RingConfig, TelemetryCollector, TelemetryUplink,
};
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
/// A window's console lines one session takes per `BROWSER_WINDOW`. Over an upload interval
/// that is at most half a ring (`browser_lines_leave_the_agent_half_the_ring`), so a window
/// throwing in a loop cannot crowd out the agent's own lines.
pub const BROWSER_LINES_PER_WINDOW: u32 = 8;
pub const BROWSER_WINDOW: Duration = Duration::from_secs(60);
/// Most console lines one `BrowserConsole` request may carry; the rest are dropped.
pub const BROWSER_LINES_PER_REQUEST: usize = 8;
/// A console line whose message or stack is longer is dropped, never cut before redaction.
/// The UI cuts its own lines well under this (lib/telemetry/console-capture).
pub const BROWSER_FIELD_BYTES: usize = 4 * 1024;

/// The collector for the log layer and the uplink for the service, sharing one ring set.
pub fn build(
    agent_version: &str,
    os: &str,
) -> Result<(Arc<TelemetryCollector>, TelemetryUplink), String> {
    let ring = RingConfig::new(RING_MAX_ENTRIES, RING_MAX_BYTES, RING_MAX_MESSAGE_BYTES)
        .map_err(|err| err.to_string())?;
    let collector = TelemetryCollector::new(ring);
    let codec = Arc::new(WorkspaceTelemetryCodec::new(agent_version, os));
    let browser = BrowserLimits::new(
        BROWSER_LINES_PER_WINDOW,
        u64::try_from(BROWSER_WINDOW.as_millis()).map_err(|err| err.to_string())?,
        BROWSER_LINES_PER_REQUEST,
        BROWSER_FIELD_BYTES,
    )
    .map_err(|err| err.to_string())?;
    let uplink = TelemetryUplink::new(collector.clone(), codec, UPLOAD_INTERVAL)?
        .with_browser_console(browser);
    Ok((collector, uplink))
}

#[cfg(test)]
mod tests;
