//! The kernel's relay, hardened (S4, S6, E2, E7): a session's heads and advertisements are
//! limited before anything is read for them, a stream past its deadline is cancelled to both
//! ends, and relay frames and egress bytes reach the usage meter.

use super::egress_tests::{answer, RecordingHost};
use super::kernel_call_tests::fetch;
use super::test_ihttp::*;
use super::test_manifests::*;
use super::test_runtime::*;
use super::usage_meter::{CountingMeter, Usage};
use crate::kernel::command_processor::apps_ihttp_end::with_relay;
use citadel_app_sdk_types::calls::HttpResponse;
use citadel_app_sdk_types::HostReply;
use citadel_ihttp_types::{CancelReason, IhttpFrameKind, MAX_REQUESTS_PER_SECOND_PER_CALLER};
use citadel_workspace_types::apps::{Capability, InstallScope};
use citadel_workspace_types::apps_install::AppsRefusal;
use citadel_workspace_types::apps_responses::AppsResponse;
use std::sync::Arc;

fn rate_limited() -> AppsRefusal {
    AppsRefusal::Limit("ihttp_rate".to_string())
}

/// An install id nothing holds: every answer that reads it is `Unavailable`.
const NOWHERE: &str = "no-such-install";

#[tokio::test]
async fn a_session_s_heads_are_limited_before_anything_is_read_for_them() {
    let kernel = workspace_serving(wasm(1, 4096)).await;
    for stream in 1..=u64::from(MAX_REQUESTS_PER_SECOND_PER_CALLER) {
        let read = send(
            &kernel,
            "alice",
            ALICE,
            NOWHERE,
            user("bob"),
            head(stream, "workspace"),
        );
        assert_eq!(refusal(&read.await), Some(&AppsRefusal::Unavailable));
    }
    // Past the budget the answer is the limit, not the lookup's: nothing was read for it.
    let over = send(
        &kernel,
        "alice",
        ALICE,
        NOWHERE,
        user("bob"),
        head(99, "workspace"),
    )
    .await;
    assert_eq!(refusal(&over), Some(&rate_limited()));
    // Another session has its own budget, and frames that are not heads are not counted.
    let bob = send(
        &kernel,
        "bob",
        BOB,
        NOWHERE,
        user("alice"),
        head(1, "workspace"),
    )
    .await;
    assert_eq!(refusal(&bob), Some(&AppsRefusal::Unavailable));
    let body = frame(1, IhttpFrameKind::End);
    let not_a_head = send(&kernel, "alice", ALICE, NOWHERE, user("bob"), body).await;
    assert_eq!(refusal(&not_a_head), Some(&AppsRefusal::Unavailable));
}

#[tokio::test]
async fn a_session_s_advertisements_are_limited_before_anything_is_read_for_them() {
    let kernel = workspace_serving(wasm(1, 4096)).await;
    for _ in 0..2 {
        let read = advertise(&kernel, "bob", Some(BOB), NOWHERE).await;
        assert_eq!(refusal(&read), Some(&AppsRefusal::Unavailable));
    }
    let over = advertise(&kernel, "bob", Some(BOB), NOWHERE).await;
    assert_eq!(refusal(&over), Some(&rate_limited()));
}

#[tokio::test]
async fn a_stream_past_its_deadline_is_cancelled_to_both_ends() {
    let kernel = workspace_serving(wasm(1, 4096)).await;
    let id = install(&kernel, "boss", InstallScope::Workspace, BOTH).await;
    advertise(&kernel, "bob", Some(BOB), &id).await;
    let mut rx = kernel.subscribe_broadcast();
    let sent = send(
        &kernel,
        "alice",
        ALICE,
        &id,
        user("bob"),
        head(1, "workspace"),
    )
    .await;
    assert_eq!(sent, AppsResponse::IhttpSent);
    let (_, _, request) = pushed(&mut rx, BOB);
    with_relay(&kernel, |relay| relay.expire(now_ms() + 31_000));
    let (from, _, to_alice) = pushed(&mut rx, ALICE);
    let (_, _, to_bob) = pushed(&mut rx, BOB);
    let timeout = IhttpFrameKind::Cancel {
        reason: CancelReason::Timeout,
    };
    assert_eq!((from.as_str(), to_alice.stream), ("bob", 1));
    assert_eq!(to_alice.kind, timeout);
    assert_eq!((to_bob.stream, to_bob.kind), (request.stream, timeout));
}

#[tokio::test]
async fn relayed_frames_and_egress_answers_reach_the_meter() {
    let mut kernel = workspace_serving(wasm(1, 4096)).await;
    let meter = Arc::new(CountingMeter::default());
    kernel.set_usage_meter(Some(meter.clone()));
    let mut host = RecordingHost::default();
    host.names
        .insert(API_HOST.into(), vec!["93.184.216.34".parse().expect("ip")]);
    let url = "https://api.acme.example:443/v1";
    host.answers.insert(url.into(), answer(200, None, b"hello"));
    let deployment = citadel_app_net_policy::Deployment {
        page_origin_host: "acme.work.example".to_string(),
    };
    let egress = super::egress::ServerEgress::new(Arc::new(host), deployment);
    kernel.set_server_egress(Some(Arc::new(egress)));
    let caps = [
        Capability::NetServer,
        Capability::IhttpServe,
        Capability::IhttpCall,
    ];
    let id = install(&kernel, "boss", InstallScope::Workspace, &caps).await;
    let reply: HostReply<HttpResponse> = call(&kernel, "alice", &id, &fetch()).await;
    assert!(reply.into_result().is_ok());
    assert_eq!(meter.total(None, Usage::EgressIn), 5);
    advertise(&kernel, "bob", Some(BOB), &id).await;
    let bytes = head(1, "workspace");
    let sent = bytes.len() as u64;
    assert_eq!(
        send(&kernel, "alice", ALICE, &id, user("bob"), bytes).await,
        AppsResponse::IhttpSent
    );
    assert_eq!(meter.total(Some(ALICE), Usage::RelayIhttp), sent);
    let refused = send(
        &kernel,
        "alice",
        ALICE,
        &id,
        user("bob"),
        head(1, "workspace"),
    )
    .await;
    assert!(refusal(&refused).is_some(), "a reused id is refused");
    assert_eq!(
        meter.total(Some(ALICE), Usage::RelayIhttp),
        sent,
        "a refused frame is not metered"
    );
}
