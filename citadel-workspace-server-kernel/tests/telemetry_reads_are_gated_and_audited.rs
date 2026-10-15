//! Telemetry is read by holders of ViewTelemetry, and by Avarok support only while an admin's
//! grant is on. Every read is in the access log. A user's erasure removes theirs and no one
//! else's.
//!
//! No mocks: the real command processor and storage.

use citadel_workspace_types::telemetry::{
    TelemetryAccessor, TelemetryFilter, TelemetryRequest, TelemetryResponse,
};
use common::telemetry_test_utils::{
    ask, batch, everything, hosted_kernel, member, messages, opt_in, refusal, telemetry, upload,
    FIRST_PAGE,
};
use common::workspace_test_utils::TEST_ADMIN_USER_ID as ADMIN;

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("clock after the epoch")
        .as_millis() as u64
}

fn list() -> TelemetryRequest {
    TelemetryRequest::ListTelemetry {
        filter: everything(),
        page: FIRST_PAGE,
    }
}

fn of(user: &str) -> TelemetryFilter {
    TelemetryFilter {
        user_id: Some(user.to_string()),
        ..everything()
    }
}

async fn access_log(kernel: &common::member_test_utils::GateKernel) -> Vec<TelemetryAccessor> {
    match telemetry(ask(kernel, ADMIN, TelemetryRequest::ListTelemetryAccessLog).await) {
        TelemetryResponse::AccessLog(rows) => rows.into_iter().map(|r| r.accessor).collect(),
        other => panic!("{other:?}"),
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_member_cannot_read_telemetry_and_an_admin_can() {
    let kernel = hosted_kernel().await;
    member(&kernel, "alice").await;
    opt_in(&kernel, "alice").await;
    upload(&kernel, "alice", batch("a", 1, 10)).await;

    assert!(refusal(ask(&kernel, "alice", list()).await).contains("ViewTelemetry"));
    assert!(
        refusal(ask(&kernel, "alice", TelemetryRequest::ListTelemetryAccessLog).await)
            .contains("ViewTelemetry")
    );
    assert_eq!(messages(&kernel, ADMIN, everything()).await.len(), 1);
    assert_eq!(
        access_log(&kernel).await,
        vec![TelemetryAccessor::Member {
            user_id: ADMIN.to_string()
        }]
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_member_cannot_set_the_policy_or_grant_support() {
    let kernel = hosted_kernel().await;
    member(&kernel, "alice").await;
    for request in [
        TelemetryRequest::SetTelemetryPolicy {
            retention_days: 30,
            per_user_bytes: 1 << 20,
        },
        TelemetryRequest::SetSupportAccess {
            enabled: true,
            until_ms: Some(now_ms() + 60_000),
        },
        TelemetryRequest::SetWorkspaceTerms {
            text: Some("mine".to_string()),
        },
    ] {
        assert!(refusal(ask(&kernel, "alice", request).await).contains("EditWorkspaceConfig"));
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn erasure_removes_only_the_callers_rows() {
    let kernel = hosted_kernel().await;
    for user in ["alice", "bob", "carol"] {
        member(&kernel, user).await;
        opt_in(&kernel, user).await;
        upload(&kernel, user, batch(user, 2, 10)).await;
    }

    let deleted = ask(&kernel, "alice", TelemetryRequest::DeleteMyTelemetry).await;
    assert_eq!(
        telemetry(deleted),
        TelemetryResponse::Deleted { segments: 1 }
    );
    let off = ask(
        &kernel,
        "bob",
        TelemetryRequest::SetTelemetryConsent { enabled: false },
    )
    .await;
    assert!(matches!(telemetry(off), TelemetryResponse::Consent(c) if !c.telemetry_enabled));

    assert!(messages(&kernel, ADMIN, of("alice")).await.is_empty());
    assert!(messages(&kernel, ADMIN, of("bob")).await.is_empty());
    assert_eq!(messages(&kernel, ADMIN, of("carol")).await.len(), 2);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn support_reads_only_under_an_unexpired_grant_and_is_audited() {
    let kernel = hosted_kernel().await;
    member(&kernel, "alice").await;
    opt_in(&kernel, "alice").await;
    upload(&kernel, "alice", batch("a", 1, 10)).await;
    let read = |at: u64| {
        let kernel = kernel.clone();
        async move {
            kernel
                .support_list_telemetry(&everything(), &FIRST_PAGE, at)
                .await
                .expect("support read")
        }
    };

    assert!(refusal(read(now_ms()).await).contains("not granted"));
    let until = now_ms() + 60 * 60 * 1000;
    let grant = TelemetryRequest::SetSupportAccess {
        enabled: true,
        until_ms: Some(until),
    };
    assert!(
        matches!(telemetry(ask(&kernel, ADMIN, grant).await), TelemetryResponse::Settings(s) if s.support_access.enabled)
    );

    match telemetry(read(now_ms()).await) {
        TelemetryResponse::Page(page) => assert_eq!(page.records.len(), 1),
        other => panic!("{other:?}"),
    }
    assert!(refusal(read(until).await).contains("not granted"));
    assert_eq!(access_log(&kernel).await, vec![TelemetryAccessor::Support]);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_grant_needs_a_bounded_expiry() {
    let kernel = hosted_kernel().await;
    for until_ms in [
        None,
        Some(now_ms() - 1),
        Some(now_ms() + 31 * 24 * 60 * 60 * 1000),
    ] {
        let grant = TelemetryRequest::SetSupportAccess {
            enabled: true,
            until_ms,
        };
        refusal(ask(&kernel, ADMIN, grant).await);
    }
}
