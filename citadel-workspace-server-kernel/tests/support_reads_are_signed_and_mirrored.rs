//! The host's side of a support read: a request signed with the support key is verified, its
//! query is served by `support_list_telemetry` and audited, and a request no key of ours signed
//! never reaches the kernel. Every grant change an admin makes is told to the host's mirror
//! (the control plane's list of granted tenants); a refused change is not.
//!
//! No mocks: the real command processor and storage. The observer is the host's capability, so
//! the test supplies one that records what it is told.

use citadel_support_signature::{
    verify, Refusal, SupportAction, SupportRequest, SupportSigningKey, NONCE_LEN, SEED_LEN,
};
use citadel_workspace_server_kernel::kernel::telemetry::SupportGrantObserver;
use citadel_workspace_types::telemetry::{
    SupportAccess, TelemetryAccessor, TelemetryRequest, TelemetryResponse,
};
use common::telemetry_test_utils::{
    ask, batch, everything, member, opt_in, refusal, telemetry, upload, FIRST_PAGE,
};
use common::workspace_test_utils::{create_configured_test_kernel, TEST_ADMIN_USER_ID as ADMIN};
use std::sync::{Arc, Mutex};

// A fixed seed: the test needs a reproducible key pair, never a real one.
const SEED: [u8; SEED_LEN] = [3; SEED_LEN];
const AUDIENCE: &str = "work.avarok.net";

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("clock after the epoch")
        .as_millis() as u64
}

#[derive(Default)]
struct Recorded(Mutex<Vec<SupportAccess>>);

#[async_trait::async_trait]
impl SupportGrantObserver for Recorded {
    async fn support_access_changed(&self, access: SupportAccess) {
        self.0.lock().expect("unpoisoned").push(access);
    }
}

fn grant(until_ms: Option<u64>) -> TelemetryRequest {
    TelemetryRequest::SetSupportAccess {
        enabled: until_ms.is_some(),
        until_ms,
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_verified_request_is_served_and_audited_and_an_unsigned_one_is_not() {
    let recorded = Arc::new(Recorded::default());
    let observer: Arc<dyn SupportGrantObserver> = recorded.clone();
    let kernel = create_configured_test_kernel(|k| {
        k.set_platform_terms_required(true);
        k.set_support_grant_observer(Some(observer))
    })
    .await;
    member(&kernel, "alice").await;
    opt_in(&kernel, "alice").await;
    upload(&kernel, "alice", batch("a", 1, 10)).await;
    let until = now_ms() + 60 * 60 * 1000;
    telemetry(ask(&kernel, ADMIN, grant(Some(until))).await);

    let key = SupportSigningKey::from_seed(&SEED);
    let action = SupportAction::FetchTelemetry {
        tenant: "acme".to_string(),
        filter: everything(),
        page: FIRST_PAGE,
    };
    let request = SupportRequest::new(AUDIENCE, action, &[1; NONCE_LEN], now_ms(), 60_000)
        .expect("a valid lifetime");
    let signed = key.sign(&request);
    let verified = verify(&key.public_key_hex(), &signed, AUDIENCE, now_ms()).expect("verifies");
    let SupportAction::FetchTelemetry { filter, page, .. } = verified.action else {
        panic!("a fetch");
    };
    let served = kernel
        .support_list_telemetry(&filter, &page, now_ms())
        .await
        .expect("support read");
    match telemetry(served) {
        TelemetryResponse::Page(page) => assert_eq!(page.records.len(), 1),
        other => panic!("{other:?}"),
    }
    let log: Vec<TelemetryAccessor> =
        match telemetry(ask(&kernel, ADMIN, TelemetryRequest::ListTelemetryAccessLog).await) {
            TelemetryResponse::AccessLog(rows) => rows.into_iter().map(|r| r.accessor).collect(),
            other => panic!("{other:?}"),
        };
    assert_eq!(log, vec![TelemetryAccessor::Support]);

    let forged = SupportSigningKey::from_seed(&[4; SEED_LEN]).sign(&request);
    assert_eq!(
        verify(&key.public_key_hex(), &forged, AUDIENCE, now_ms()),
        Err(Refusal::Invalid)
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn every_grant_change_reaches_the_host_and_a_refused_one_does_not() {
    let recorded = Arc::new(Recorded::default());
    let observer: Arc<dyn SupportGrantObserver> = recorded.clone();
    let kernel = create_configured_test_kernel(|k| {
        k.set_platform_terms_required(true);
        k.set_support_grant_observer(Some(observer))
    })
    .await;
    member(&kernel, "alice").await;
    let until = now_ms() + 60 * 60 * 1000;

    refusal(ask(&kernel, "alice", grant(Some(until))).await);
    refusal(ask(&kernel, ADMIN, grant(Some(now_ms() - 1))).await);
    assert!(recorded.0.lock().expect("unpoisoned").is_empty());

    telemetry(ask(&kernel, ADMIN, grant(Some(until))).await);
    telemetry(ask(&kernel, ADMIN, grant(None)).await);
    assert_eq!(
        *recorded.0.lock().expect("unpoisoned"),
        vec![
            SupportAccess {
                enabled: true,
                until_ms: Some(until)
            },
            SupportAccess {
                enabled: false,
                until_ms: None
            },
        ]
    );
}
