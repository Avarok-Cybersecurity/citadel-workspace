//! The workspace protocol's TURN usage frames: what the agent sends a metering server, and how
//! it reads that server's answers. Real frames, no link.

use super::WorkspaceTelemetryCodec;
use citadel_internal_service::telemetry::{ServerSignal, TelemetryCodec};
use citadel_workspace_types::telemetry::{TelemetryRequest, TelemetryResponse};
use citadel_workspace_types::terms::MyConsent;
use citadel_workspace_types::turn_usage::{TurnUsage, MAX_TURN_USAGE_REPORT_BYTES};
use citadel_workspace_types::{
    WorkspaceProtocolPayload, WorkspaceProtocolRequest, WorkspaceProtocolResponse,
};

fn codec() -> WorkspaceTelemetryCodec {
    WorkspaceTelemetryCodec::new("9.9.9", "testos")
}

fn answer(response: TelemetryResponse) -> Vec<u8> {
    let payload = WorkspaceProtocolPayload::Response(Box::new(
        WorkspaceProtocolResponse::Telemetry(response),
    ));
    serde_json::to_vec(&payload).unwrap()
}

fn consent(meters_turn: Option<bool>) -> Vec<u8> {
    answer(TelemetryResponse::Consent(MyConsent {
        accepted_platform_version: None,
        accepted_workspace_version: None,
        required_platform_version: 1,
        required_workspace_version: None,
        terms_current: false,
        telemetry_enabled: false,
        uploads_allowed: false,
        metric_format: None,
        meters_turn,
    }))
}

fn usage(frame: &[u8]) -> TurnUsage {
    match serde_json::from_slice(frame).unwrap() {
        WorkspaceProtocolPayload::Request(WorkspaceProtocolRequest::Telemetry(
            TelemetryRequest::ReportTurnUsage { usage },
        )) => usage,
        _ => panic!("not a TURN usage report"),
    }
}

#[test]
fn a_large_growth_goes_as_reports_the_server_accepts() {
    let frames = codec()
        .turn_usage_frames((MAX_TURN_USAGE_REPORT_BYTES + 5, 3))
        .unwrap();
    let reports: Vec<TurnUsage> = frames.iter().map(|f| usage(f)).collect();
    assert!(reports.iter().all(|u| u.total().is_ok()), "{reports:?}");
    let sum = reports
        .iter()
        .fold((0, 0), |a, u| (a.0 + u.tx_bytes, a.1 + u.rx_bytes));
    assert_eq!(sum, (MAX_TURN_USAGE_REPORT_BYTES + 5, 3));
}

#[test]
fn only_a_server_that_says_it_meters_turn_is_sent_reports() {
    let meters = |frame: Vec<u8>| match codec().classify(&frame) {
        ServerSignal::Consent { meters_turn, .. } => meters_turn,
        _ => panic!("not a consent answer"),
    };
    assert!(meters(consent(Some(true))));
    assert!(!meters(consent(Some(false))));
    assert!(!meters(consent(None)), "a server built before the report");
    let recorded = codec().classify(&answer(TelemetryResponse::TurnUsageRecorded));
    assert_eq!(recorded, ServerSignal::TurnUsageRecorded);
}
