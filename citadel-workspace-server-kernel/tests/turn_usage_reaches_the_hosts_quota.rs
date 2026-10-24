//! A member's agent reports its TURN bytes; the kernel hands them to the host's relay quota.
//! A server whose host keeps no quota says it meters none and refuses the report, and a report
//! over the per-report bound is refused whole.
//!
//! No mocks of the kernel: the real command processor. The host's quota is a recorder, since
//! the real one is the tenant Durable Object (deploy/tenant-worker, tested there).

use citadel_workspace_server_kernel::kernel::telemetry::TurnUsageSink;
use citadel_workspace_types::telemetry::{TelemetryRequest, TelemetryResponse};
use citadel_workspace_types::turn_usage::{
    TurnUsage, TurnUsageRefusal, MAX_TURN_USAGE_REPORT_BYTES,
};
use common::telemetry_test_utils::{ask, hosted_kernel, member, refusal, telemetry};
use common::workspace_test_utils::create_configured_test_kernel;
use std::sync::{Arc, Mutex};

/// Counts what it is told, and refuses any single report over `refuse_over` bytes, as the
/// host's per-member cap would (its own rule is tested in deploy/tenant-worker).
struct Quota {
    counted: Mutex<Vec<(String, u64)>>,
    refuse_over: u64,
}

const HOST_CAP: u64 = 5_000;

#[async_trait::async_trait]
impl TurnUsageSink for Quota {
    async fn record_turn_bytes(&self, user_id: &str, bytes: u64) -> Result<(), TurnUsageRefusal> {
        if bytes > self.refuse_over {
            return Err(TurnUsageRefusal::MemberHourlyCap {
                cap_bytes: self.refuse_over,
                counted_bytes: 0,
                claimed_bytes: bytes,
            });
        }
        self.counted
            .lock()
            .unwrap()
            .push((user_id.to_string(), bytes));
        Ok(())
    }
}

fn report(tx_bytes: u64, rx_bytes: u64) -> TelemetryRequest {
    TelemetryRequest::ReportTurnUsage {
        usage: TurnUsage { tx_bytes, rx_bytes },
    }
}

async fn meters_turn(kernel: &common::member_test_utils::GateKernel) -> Option<bool> {
    match telemetry(ask(kernel, "alice", TelemetryRequest::GetMyConsent).await) {
        TelemetryResponse::Consent(c) => c.meters_turn,
        other => panic!("no consent answer: {other:?}"),
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_report_reaches_the_hosts_quota_for_its_member() {
    let quota = Arc::new(Quota {
        counted: Mutex::default(),
        refuse_over: HOST_CAP,
    });
    let sink = quota.clone();
    let kernel = create_configured_test_kernel(move |kernel| {
        kernel.set_platform_terms_required(true);
        kernel.set_turn_usage_sink(Some(sink));
    })
    .await;
    member(&kernel, "alice").await;
    assert_eq!(meters_turn(&kernel).await, Some(true));
    let answer = ask(&kernel, "alice", report(300, 700)).await;
    assert!(matches!(
        telemetry(answer),
        TelemetryResponse::TurnUsageRecorded
    ));
    let over = ask(&kernel, "alice", report(MAX_TURN_USAGE_REPORT_BYTES + 1, 0)).await;
    assert!(refusal(over).contains("TURN usage report"));
    let capped = ask(&kernel, "alice", report(HOST_CAP, 1)).await;
    assert_eq!(
        telemetry(capped),
        TelemetryResponse::TurnUsageRefused(TurnUsageRefusal::MemberHourlyCap {
            cap_bytes: HOST_CAP,
            counted_bytes: 0,
            claimed_bytes: HOST_CAP + 1,
        }),
        "the host's refusal reaches the agent typed"
    );
    assert_eq!(
        *quota.counted.lock().unwrap(),
        vec![("alice".to_string(), 1000)]
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_server_without_a_quota_meters_none() {
    let kernel = hosted_kernel().await;
    member(&kernel, "alice").await;
    assert_eq!(meters_turn(&kernel).await, Some(false));
    let answer = ask(&kernel, "alice", report(300, 700)).await;
    assert!(refusal(answer).contains("does not meter TURN"));
}
