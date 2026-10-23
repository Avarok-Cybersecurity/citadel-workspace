//! The shipped wiring in process: the shipped log subscriber and filter, the shipped ring
//! bounds and the real workspace protocol frames. Only the C2S link is replaced, by `Link`,
//! which records frames: a real one needs a running server.

use super::*;
use crate::log_setup::{subscriber, SHIPPED_LOG_FILTER};
use citadel_internal_service::telemetry::span::session_span;
use citadel_internal_service::telemetry::ServerSignal;
use citadel_internal_service::telemetry::{KnownValue, RedactionKind, SessionLink, TelemetryCodec};
use citadel_workspace_types::telemetry::{
    TelemetryBatch, TelemetryRequest, TelemetryResponse, TelemetryUploadRefusal,
};
use citadel_workspace_types::telemetry_metric::TELEMETRY_METRIC_FORMAT_VERSION;
use citadel_workspace_types::terms::MyConsent;
use citadel_workspace_types::{
    WorkspaceProtocolPayload, WorkspaceProtocolRequest, WorkspaceProtocolResponse,
};
use std::future::Future;
use std::pin::Pin;
use std::sync::Mutex;
use tracing::Instrument;

const ALICE: u64 = 7_707;
const BOB: u64 = 8_808;

#[derive(Default)]
struct Link(Mutex<Vec<(u64, Vec<u8>)>>);

impl SessionLink for Link {
    fn send_to_server(
        &self,
        cid: u64,
        frame: Vec<u8>,
    ) -> Pin<Box<dyn Future<Output = Result<(), String>> + Send + 'static>> {
        self.0.lock().unwrap().push((cid, frame));
        Box::pin(async { Ok(()) })
    }
}

fn answer(response: TelemetryResponse) -> Vec<u8> {
    let payload = WorkspaceProtocolPayload::Response(Box::new(
        WorkspaceProtocolResponse::Telemetry(response),
    ));
    serde_json::to_vec(&payload).unwrap()
}

fn consent(uploads_allowed: bool) -> Vec<u8> {
    answer(TelemetryResponse::Consent(MyConsent {
        accepted_platform_version: Some(1),
        accepted_workspace_version: None,
        required_platform_version: 1,
        required_workspace_version: None,
        terms_current: true,
        telemetry_enabled: uploads_allowed,
        uploads_allowed,
        metric_format: Some(TELEMETRY_METRIC_FORMAT_VERSION),
    }))
}

fn uplink() -> TelemetryUplink {
    let (collector, uplink) = build("9.9.9", "testos").unwrap();
    for (cid, name) in [(ALICE, "alice"), (BOB, "bob")] {
        collector.register_session(
            cid,
            vec![
                KnownValue {
                    kind: RedactionKind::Username,
                    value: name.into(),
                },
                KnownValue {
                    kind: RedactionKind::Host,
                    value: "ws.example.org".into(),
                },
            ],
        );
    }
    uplink
}

/// One WARN per session through the shipped subscriber, which prints errors only.
async fn warn_each_and_flush(uplink: &TelemetryUplink) -> Vec<(u64, Vec<u8>)> {
    let printed = subscriber(
        SHIPPED_LOG_FILTER,
        std::io::sink,
        uplink.collector().clone(),
    );
    let _guard = tracing::subscriber::set_default(printed);
    async {
        tracing::warn!(target: "citadel", "alice lost ws.example.org; session {BOB} unaffected")
    }
    .instrument(session_span(ALICE))
    .await;
    async { tracing::warn!(target: "citadel", "bob lost ws.example.org") }
        .instrument(session_span(BOB))
        .await;
    let link = Link::default();
    uplink.flush(&link).await;
    link.0.into_inner().unwrap()
}

fn uploaded(frame: &[u8]) -> TelemetryBatch {
    match serde_json::from_slice(frame).unwrap() {
        WorkspaceProtocolPayload::Request(WorkspaceProtocolRequest::Telemetry(
            TelemetryRequest::UploadTelemetry { batch },
        )) => batch,
        other => panic!("not an upload: {other:?}"),
    }
}

#[tokio::test]
async fn an_opted_in_sessions_warning_is_uploaded_redacted_on_its_own_link() {
    let uplink = uplink();
    assert!(
        uplink.on_server_frame(ALICE, &consent(true)),
        "consent reaches the window"
    );
    let sent = warn_each_and_flush(&uplink).await;
    assert_eq!(sent.len(), 1, "only the opted-in session uploads");
    assert_eq!(sent[0].0, ALICE, "on that session's link");
    let batch = uploaded(&sent[0].1);
    assert_eq!(
        (
            batch.format_version,
            batch.agent_version.as_str(),
            batch.os.as_str()
        ),
        (1, "9.9.9", "testos")
    );
    assert_eq!(batch.entries.len(), 1, "{:?}", batch.entries);
    let line = &batch.entries[0].message;
    for leak in ["alice", "ws.example.org", &BOB.to_string()] {
        assert!(!line.contains(leak), "{leak} in {line}");
    }
    assert!(
        line.contains("<user:") && line.contains("<host:") && line.contains("<session:"),
        "{line}"
    );
}

#[tokio::test]
async fn a_session_that_did_not_opt_in_sends_nothing() {
    let uplink = uplink();
    uplink.on_server_frame(ALICE, &consent(false));
    assert!(warn_each_and_flush(&uplink).await.is_empty());
}

#[tokio::test]
async fn an_upload_refused_stops_uploads() {
    let uplink = uplink();
    uplink.on_server_frame(ALICE, &consent(true));
    let refused = answer(TelemetryResponse::UploadRefused(
        TelemetryUploadRefusal::TermsOutdated,
    ));
    assert!(
        !uplink.on_server_frame(ALICE, &refused),
        "the agent's answer is not forwarded"
    );
    assert!(warn_each_and_flush(&uplink).await.is_empty());
}

#[test]
fn the_consent_query_is_get_my_consent() {
    let frame = WorkspaceTelemetryCodec::new("v", "os")
        .consent_query()
        .unwrap();
    let payload: WorkspaceProtocolPayload = serde_json::from_slice(&frame).unwrap();
    assert!(matches!(
        payload,
        WorkspaceProtocolPayload::Request(WorkspaceProtocolRequest::Telemetry(
            TelemetryRequest::GetMyConsent
        ))
    ));
}

#[test]
fn batches_split_at_the_entry_and_byte_limits() {
    use citadel_workspace_types::telemetry::{
        TelemetryEntry, TelemetryLevel, MAX_TELEMETRY_BATCH_BYTES,
    };
    let codec = WorkspaceTelemetryCodec::new("v", "os");
    let line = |message: String| TelemetryEntry {
        time_ms: 1,
        level: TelemetryLevel::Warn,
        target: "t".into(),
        message,
        peer_cid: None,
        metric: None,
    };
    let many = codec
        .split(
            (0..MAX_TELEMETRY_BATCH_ENTRIES + 1)
                .map(|n| line(n.to_string()))
                .collect(),
        )
        .unwrap();
    let counts: Vec<usize> = many.iter().map(|f| uploaded(f).entries.len()).collect();
    assert_eq!(counts, [MAX_TELEMETRY_BATCH_ENTRIES, 1]);
    let big = codec
        .split(
            (0..300)
                .map(|_| line("x".repeat(RING_MAX_MESSAGE_BYTES)))
                .collect(),
        )
        .unwrap();
    assert!(big.len() > 1);
    assert!(big.iter().all(|f| f.len() <= MAX_TELEMETRY_BATCH_BYTES));
    assert_eq!(
        big.iter().map(|f| uploaded(f).entries.len()).sum::<usize>(),
        300
    );
    assert!(codec
        .split(vec![line("x".repeat(MAX_TELEMETRY_BATCH_BYTES))])
        .is_err());
}

#[cfg(test)]
#[path = "browser_tests.rs"]
mod browser;

/// A server built before metrics sends no `metric_format`; one that stores another format
/// names it. Neither is sent metrics, and both still take the session's log lines.
#[test]
fn only_a_server_naming_this_metric_format_is_sent_metrics() {
    let codec = WorkspaceTelemetryCodec::new("9.9.9", "testos");
    let current = consent(true);
    let mut older: serde_json::Value = serde_json::from_slice(&current).unwrap();
    let removed = older["Response"]["Telemetry"]["Consent"]
        .as_object_mut()
        .unwrap()
        .remove("metric_format");
    assert!(removed.is_some(), "{older}");
    let mut other = older.clone();
    other["Response"]["Telemetry"]["Consent"]["metric_format"] =
        (TELEMETRY_METRIC_FORMAT_VERSION + 1).into();
    let signal = |frame: &serde_json::Value| codec.classify(&serde_json::to_vec(frame).unwrap());
    let takes = |s: ServerSignal| match s {
        ServerSignal::Consent {
            uploads_allowed: true,
            takes_metrics,
        } => takes_metrics,
        _ => panic!("not an allowing consent answer"),
    };
    assert!(takes(codec.classify(&current)));
    assert!(!takes(signal(&older)));
    assert!(!takes(signal(&other)));
}
