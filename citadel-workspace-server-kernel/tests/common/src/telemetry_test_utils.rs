//! Driving the Telemetry Service through the real command processor.

use crate::member_test_utils::{insert_user_with_role, join_root, GateKernel};
use citadel_workspace_server_kernel::kernel::command_processor::async_process_command::process_command_with_user;
use citadel_workspace_types::structs::UserRole;
use citadel_workspace_types::telemetry::{
    TelemetryBatch, TelemetryEntry, TelemetryFilter, TelemetryLevel, TelemetryPage,
    TelemetryRequest, TelemetryResponse, TELEMETRY_BATCH_FORMAT_VERSION,
};
use citadel_workspace_types::terms::PLATFORM_TERMS_VERSION;
use citadel_workspace_types::{WorkspaceProtocolRequest, WorkspaceProtocolResponse};

/// A kernel configured as an Avarok-hosted tenant: its users were shown the platform terms.
pub async fn hosted_kernel() -> std::sync::Arc<GateKernel> {
    crate::workspace_test_utils::create_configured_test_kernel(|kernel| {
        kernel.set_platform_terms_required(true)
    })
    .await
}

pub async fn ask(
    kernel: &GateKernel,
    user: &str,
    request: TelemetryRequest,
) -> WorkspaceProtocolResponse {
    process_command_with_user(kernel, &WorkspaceProtocolRequest::Telemetry(request), user)
        .await
        .expect("dispatch failed")
}

pub fn telemetry(response: WorkspaceProtocolResponse) -> TelemetryResponse {
    match response {
        WorkspaceProtocolResponse::Telemetry(response) => response,
        other => panic!("expected a telemetry response, got {other:?}"),
    }
}

pub fn refusal(response: WorkspaceProtocolResponse) -> String {
    match response {
        WorkspaceProtocolResponse::Error(e) => e,
        other => panic!("expected a refusal, got {other:?}"),
    }
}

pub async fn member(kernel: &GateKernel, id: &str) {
    insert_user_with_role(kernel, id, UserRole::Member).await;
    join_root(kernel, id).await;
}

/// Accept the current platform terms (the test workspace has none of its own) and opt in.
pub async fn opt_in(kernel: &GateKernel, user: &str) {
    let accepted = ask(
        kernel,
        user,
        TelemetryRequest::AcceptTerms {
            platform_version: PLATFORM_TERMS_VERSION,
            workspace_version: None,
        },
    )
    .await;
    assert!(matches!(telemetry(accepted), TelemetryResponse::Consent(_)));
    let on = ask(
        kernel,
        user,
        TelemetryRequest::SetTelemetryConsent { enabled: true },
    )
    .await;
    match telemetry(on) {
        TelemetryResponse::Consent(c) => assert!(c.uploads_allowed, "{c:?}"),
        other => panic!("opting in failed: {other:?}"),
    }
}

/// A batch of `count` entries whose messages are `message_len` bytes, tagged with `tag`.
pub fn batch(tag: &str, count: usize, message_len: usize) -> TelemetryBatch {
    TelemetryBatch {
        format_version: TELEMETRY_BATCH_FORMAT_VERSION,
        agent_version: "0.9.1".to_string(),
        os: "macos".to_string(),
        entries: (0..count)
            .map(|i| TelemetryEntry {
                time_ms: 1_000 + i as u64,
                level: TelemetryLevel::Warn,
                target: "citadel_agent::session".to_string(),
                message: format!("{tag}:{i}:{}", "x".repeat(message_len)),
                peer_cid: Some(42),
            })
            .collect(),
    }
}

pub async fn upload(kernel: &GateKernel, user: &str, batch: TelemetryBatch) -> TelemetryResponse {
    telemetry(ask(kernel, user, TelemetryRequest::UploadTelemetry { batch }).await)
}

pub fn everything() -> TelemetryFilter {
    TelemetryFilter {
        user_id: None,
        peer_cid: None,
        min_level: None,
        since_ms: None,
        until_ms: None,
    }
}

pub const FIRST_PAGE: TelemetryPage = TelemetryPage {
    offset: 0,
    limit: 500,
};

/// Every stored message, newest first, as `reader` lists them.
pub async fn messages(kernel: &GateKernel, reader: &str, filter: TelemetryFilter) -> Vec<String> {
    let listed = ask(
        kernel,
        reader,
        TelemetryRequest::ListTelemetry {
            filter,
            page: FIRST_PAGE,
        },
    )
    .await;
    match telemetry(listed) {
        TelemetryResponse::Page(page) => {
            page.records.into_iter().map(|r| r.entry.message).collect()
        }
        other => panic!("listing failed: {other:?}"),
    }
}
