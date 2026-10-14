//! Telemetry is stored only for a member who opted in under the current terms, and each
//! user's share is bounded by bytes and by age, oldest first.
//!
//! No mocks: the real command processor and storage.

use citadel_workspace_types::telemetry::{
    TelemetryRequest, TelemetryResponse, TelemetryUploadRefusal, MAX_TELEMETRY_BATCH_BYTES,
    MAX_TELEMETRY_PER_USER_BYTES, MAX_TELEMETRY_RETENTION_DAYS,
};
use citadel_workspace_types::terms::PLATFORM_TERMS_VERSION;
use common::telemetry_test_utils::{
    ask, batch, everything, hosted_kernel, member, messages, opt_in, refusal, telemetry, upload,
};
use common::workspace_test_utils::TEST_ADMIN_USER_ID as ADMIN;

const DAY_MS: u64 = 24 * 60 * 60 * 1000;

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("clock after the epoch")
        .as_millis() as u64
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_upload_without_consent_is_refused() {
    let kernel = hosted_kernel().await;
    member(&kernel, "alice").await;
    assert_eq!(
        upload(&kernel, "alice", batch("a", 1, 10)).await,
        TelemetryResponse::UploadRefused(TelemetryUploadRefusal::ConsentOff)
    );
    assert!(messages(&kernel, ADMIN, everything()).await.is_empty());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn consent_needs_the_current_terms() {
    let kernel = hosted_kernel().await;
    member(&kernel, "alice").await;
    let on = ask(
        &kernel,
        "alice",
        TelemetryRequest::SetTelemetryConsent { enabled: true },
    )
    .await;
    assert!(refusal(on).contains("terms"));
    let stale = ask(
        &kernel,
        "alice",
        TelemetryRequest::AcceptTerms {
            platform_version: PLATFORM_TERMS_VERSION + 1,
            workspace_version: None,
        },
    )
    .await;
    assert!(refusal(stale).contains("current terms"));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn new_workspace_terms_pause_uploads_until_accepted() {
    let kernel = hosted_kernel().await;
    member(&kernel, "alice").await;
    opt_in(&kernel, "alice").await;
    assert!(matches!(
        upload(&kernel, "alice", batch("a", 1, 10)).await,
        TelemetryResponse::Uploaded { stored_entries: 1 }
    ));

    let set = ask(
        &kernel,
        ADMIN,
        TelemetryRequest::SetWorkspaceTerms {
            text: Some("Be kind.".to_string()),
        },
    )
    .await;
    let version = match telemetry(set) {
        TelemetryResponse::Terms(terms) => terms.workspace.expect("workspace terms").version,
        other => panic!("{other:?}"),
    };
    assert_eq!(
        upload(&kernel, "alice", batch("b", 1, 10)).await,
        TelemetryResponse::UploadRefused(TelemetryUploadRefusal::TermsOutdated)
    );

    let accepted = ask(
        &kernel,
        "alice",
        TelemetryRequest::AcceptTerms {
            platform_version: PLATFORM_TERMS_VERSION,
            workspace_version: Some(version),
        },
    )
    .await;
    assert!(matches!(telemetry(accepted), TelemetryResponse::Consent(c) if c.uploads_allowed));
    assert!(matches!(
        upload(&kernel, "alice", batch("c", 1, 10)).await,
        TelemetryResponse::Uploaded { .. }
    ));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_per_user_cap_drops_the_oldest_first() {
    let kernel = hosted_kernel().await;
    member(&kernel, "alice").await;
    member(&kernel, "bob").await;
    opt_in(&kernel, "alice").await;
    opt_in(&kernel, "bob").await;
    let set = ask(
        &kernel,
        ADMIN,
        TelemetryRequest::SetTelemetryPolicy {
            retention_days: 30,
            per_user_bytes: MAX_TELEMETRY_BATCH_BYTES as u64,
        },
    )
    .await;
    assert!(matches!(telemetry(set), TelemetryResponse::Settings(_)));

    // Each batch is a little over a third of the cap: three cannot be kept together.
    let third = MAX_TELEMETRY_BATCH_BYTES / 3;
    upload(&kernel, "bob", batch("bob", 1, 10)).await;
    for tag in ["first", "second", "third"] {
        upload(&kernel, "alice", batch(tag, 1, third)).await;
    }
    let kept = messages(&kernel, ADMIN, everything()).await;
    let has = |tag: &str| kept.iter().any(|m| m.starts_with(&format!("{tag}:")));
    assert!(!has("first"), "the oldest batch survived the cap");
    assert!(has("second") && has("third"), "a newer batch was dropped");
    assert!(has("bob"), "another user's telemetry paid for alice's");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_purge_removes_only_what_is_past_retention() {
    let kernel = hosted_kernel().await;
    member(&kernel, "alice").await;
    opt_in(&kernel, "alice").await;
    upload(&kernel, "alice", batch("a", 2, 10)).await;

    assert_eq!(
        kernel
            .purge_expired_telemetry(now_ms())
            .await
            .expect("purge"),
        0
    );
    assert_eq!(messages(&kernel, ADMIN, everything()).await.len(), 2);

    let later = now_ms() + 31 * DAY_MS;
    assert_eq!(
        kernel.purge_expired_telemetry(later).await.expect("purge"),
        1
    );
    assert!(messages(&kernel, ADMIN, everything()).await.is_empty());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_policy_beyond_the_platform_maximum_is_refused() {
    let kernel = hosted_kernel().await;
    for (retention_days, per_user_bytes) in [
        (
            MAX_TELEMETRY_RETENTION_DAYS + 1,
            MAX_TELEMETRY_PER_USER_BYTES,
        ),
        (0, MAX_TELEMETRY_PER_USER_BYTES),
        (30, MAX_TELEMETRY_PER_USER_BYTES + 1),
        (30, MAX_TELEMETRY_BATCH_BYTES as u64 - 1),
    ] {
        let set = TelemetryRequest::SetTelemetryPolicy {
            retention_days,
            per_user_bytes,
        };
        refusal(ask(&kernel, ADMIN, set).await);
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_batch_over_the_byte_limit_is_refused() {
    let kernel = hosted_kernel().await;
    member(&kernel, "alice").await;
    opt_in(&kernel, "alice").await;
    let response = ask(
        &kernel,
        "alice",
        TelemetryRequest::UploadTelemetry {
            batch: batch("big", 1, MAX_TELEMETRY_BATCH_BYTES),
        },
    )
    .await;
    assert!(refusal(response).contains("at most"));
}
