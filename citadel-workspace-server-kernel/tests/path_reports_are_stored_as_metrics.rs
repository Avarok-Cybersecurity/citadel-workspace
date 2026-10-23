//! An agent's path reports travel through opt-in telemetry as metric entries: stored with the
//! peer's CID, read back whole by an admin, left out by the log-level filters, and refused when
//! the level and the payload disagree.
//!
//! No mocks: the real command processor and storage.

use citadel_workspace_types::telemetry::{
    TelemetryBatch, TelemetryEntry, TelemetryFilter, TelemetryLevel, TelemetryRequest,
    TelemetryResponse, TELEMETRY_BATCH_FORMAT_VERSION,
};
use citadel_workspace_types::telemetry_metric::{
    NatClassReport, NatTranslation, PathReport, PathStageReport, PathTaken, TelemetryMetric,
    TELEMETRY_METRIC_FORMAT_VERSION,
};
use common::telemetry_test_utils::{
    ask, everything, hosted_kernel, member, messages, opt_in, refusal, telemetry, upload,
    FIRST_PAGE,
};
use common::workspace_test_utils::TEST_ADMIN_USER_ID as ADMIN;

const PEER: u64 = 4_242;

fn report() -> TelemetryMetric {
    let nat = NatClassReport {
        ip_translation: NatTranslation::Constant,
        port_translation: NatTranslation::DeltaConstantOffset,
        ipv6_enabled: false,
    };
    TelemetryMetric::PathReport(PathReport {
        attempt: 2,
        plan: "DirectThenTurn".into(),
        path: PathTaken::Turn,
        relayed_both: false,
        time_to_connect_ms: Some(2_100),
        stages: vec![PathStageReport {
            stage: "Direct".into(),
            failure: Some("PunchFailed".into()),
            elapsed_ms: 1_500,
        }],
        local_nat: nat,
        peer_nat: nat,
    })
}

fn batch(level: TelemetryLevel, metric: Option<TelemetryMetric>) -> TelemetryBatch {
    TelemetryBatch {
        format_version: TELEMETRY_BATCH_FORMAT_VERSION,
        agent_version: "0.9.1".into(),
        os: "macos".into(),
        entries: vec![TelemetryEntry {
            time_ms: 1_000,
            level,
            target: "citadel::metric".into(),
            message: "path attempt 2: DirectThenTurn plan, attached Turn".into(),
            peer_cid: Some(PEER),
            metric,
        }],
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_path_report_is_read_back_whole_with_its_peer() {
    let kernel = hosted_kernel().await;
    member(&kernel, "alice").await;
    opt_in(&kernel, "alice").await;
    // The consent answer names the metric format, which is what tells an agent to send them.
    match telemetry(ask(&kernel, "alice", TelemetryRequest::GetMyConsent).await) {
        TelemetryResponse::Consent(c) => {
            assert_eq!(c.metric_format, Some(TELEMETRY_METRIC_FORMAT_VERSION))
        }
        other => panic!("no consent answer: {other:?}"),
    }
    assert!(matches!(
        upload(
            &kernel,
            "alice",
            batch(TelemetryLevel::Metric, Some(report()))
        )
        .await,
        TelemetryResponse::Uploaded { stored_entries: 1 }
    ));
    let listed = ask(
        &kernel,
        ADMIN,
        TelemetryRequest::ListTelemetry {
            filter: everything(),
            page: FIRST_PAGE,
        },
    )
    .await;
    let TelemetryResponse::Page(page) = telemetry(listed) else {
        panic!("listing failed")
    };
    let entry = &page.records.first().expect("the report was stored").entry;
    assert_eq!(entry.level, TelemetryLevel::Metric);
    assert_eq!(entry.peer_cid, Some(PEER));
    assert_eq!(entry.metric, Some(report()));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn log_level_filters_leave_metrics_out() {
    let kernel = hosted_kernel().await;
    member(&kernel, "alice").await;
    opt_in(&kernel, "alice").await;
    upload(
        &kernel,
        "alice",
        batch(TelemetryLevel::Metric, Some(report())),
    )
    .await;
    let warnings = TelemetryFilter {
        min_level: Some(TelemetryLevel::Warn),
        ..everything()
    };
    assert!(messages(&kernel, ADMIN, warnings).await.is_empty());
    assert_eq!(messages(&kernel, ADMIN, everything()).await.len(), 1);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_level_and_payload_that_disagree_are_refused() {
    let kernel = hosted_kernel().await;
    member(&kernel, "alice").await;
    opt_in(&kernel, "alice").await;
    for bad in [
        batch(TelemetryLevel::Metric, None),
        batch(TelemetryLevel::Warn, Some(report())),
    ] {
        let response = ask(
            &kernel,
            "alice",
            TelemetryRequest::UploadTelemetry { batch: bad },
        )
        .await;
        assert!(refusal(response).contains("metric"));
    }
    assert!(messages(&kernel, ADMIN, everything()).await.is_empty());
}
