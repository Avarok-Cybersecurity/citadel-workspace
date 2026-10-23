//! `ReportTurnUsage`: an agent's TURN bytes, handed to the host's relay quota. Nothing is
//! stored here; the host keeps the count (deploy/tenant-worker, `turn_bytes`).

use super::TurnUsageSink;
use crate::WorkspaceProtocolResponse;
use citadel_sdk::prelude::NetworkError;
use citadel_workspace_types::telemetry::TelemetryResponse;
use citadel_workspace_types::turn_usage::TurnUsage;

/// Hands `usage` to `sink` for `user_id`, or refuses it: a server whose host keeps no relay
/// quota meters no TURN, and a report over the per-report bound is refused whole.
pub(super) async fn record(
    sink: Option<&dyn TurnUsageSink>,
    user_id: &str,
    usage: &TurnUsage,
) -> Result<WorkspaceProtocolResponse, NetworkError> {
    let Some(sink) = sink else {
        return Ok(WorkspaceProtocolResponse::Error(
            "This server does not meter TURN usage".to_string(),
        ));
    };
    let bytes = match usage.total() {
        Ok(bytes) => bytes,
        Err(reason) => return Ok(WorkspaceProtocolResponse::Error(reason)),
    };
    if bytes > 0 {
        sink.record_turn_bytes(user_id, bytes).await;
    }
    Ok(WorkspaceProtocolResponse::Telemetry(
        TelemetryResponse::TurnUsageRecorded,
    ))
}
