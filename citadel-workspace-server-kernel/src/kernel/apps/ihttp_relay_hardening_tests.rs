//! The relay's stream lifecycle without the kernel (S6): what an ended side may still send,
//! credit granted before the response head, where a frame goes checked before anything changes,
//! monotonic caller ids, the deadline, and the records the audit line is made from.

use super::ihttp_audit::audit_line;
use super::ihttp_flow::FlowFault;
use super::ihttp_relay::*;
use citadel_ihttp_types::{
    CancelReason, IhttpFrameKind, INITIAL_CREDIT, STREAMING_TIMEOUT_MS, STREAM_TIMEOUT_MS,
};

const NOW: u64 = 1_000_000;

fn end(cid: u64, user: &str) -> Endpoint {
    Endpoint {
        cid,
        username: user.to_string(),
        install_id: "i1".to_string(),
        app_id: "com.acme.kanban".to_string(),
    }
}

fn any(_: &Endpoint) -> bool {
    true
}

fn body(n: usize) -> IhttpFrameKind {
    IhttpFrameKind::Body { bytes: vec![0; n] }
}

fn cancel() -> IhttpFrameKind {
    IhttpFrameKind::Cancel {
        reason: CancelReason::Caller,
    }
}

/// alice (cid 1) calls bob (cid 2) on her stream `stream`; answers the relay's id.
fn opened(relay: &mut IhttpRelay, stream: u64) -> u64 {
    relay
        .open(end(1, "alice"), stream, end(2, "bob"), None, NOW)
        .expect("open")
}

fn head() -> IhttpFrameKind {
    IhttpFrameKind::ResponseHead {
        status: 200,
        headers: vec![],
        body_len: None,
    }
}

#[test]
fn a_cancel_after_the_caller_s_own_end_is_admitted_and_closes_the_stream() {
    let mut relay = IhttpRelay::default();
    let id = opened(&mut relay, 1);
    let end_frame = IhttpFrameKind::End;
    relay
        .from_client(1, "i1", 1, &end_frame, any, NOW)
        .expect("end");
    // Control: anything else after End is still refused.
    let after = relay.from_client(1, "i1", 1, &body(1), any, NOW);
    assert_eq!(after, Err(RelayFault::Flow(FlowFault::AfterEnd)));
    let gave_up = relay.from_client(1, "i1", 1, &cancel(), any, NOW);
    assert_eq!(gave_up.map(|f| f.stream), Ok(id));
    assert_eq!(
        relay.from_server(2, "i1", id, &head(), any, NOW),
        Err(RelayFault::NoStream),
        "the cancel closed the stream"
    );
}

#[test]
fn credit_granted_before_the_response_head_survives_it() {
    let mut relay = IhttpRelay::default();
    let id = opened(&mut relay, 1);
    let grant = IhttpFrameKind::Credit { n: 4 };
    relay
        .from_client(1, "i1", 1, &grant, any, NOW)
        .expect("credit");
    relay
        .from_server(2, "i1", id, &head(), any, NOW)
        .expect("head");
    for _ in 0..INITIAL_CREDIT + 4 {
        relay
            .from_server(2, "i1", id, &body(1), any, NOW)
            .expect("credited");
    }
    let dry = relay.from_server(2, "i1", id, &body(1), any, NOW);
    assert_eq!(dry, Err(RelayFault::Flow(FlowFault::NoCredit)));
}

#[test]
fn a_misaddressed_frame_changes_nothing() {
    let mut relay = IhttpRelay::default();
    let id = opened(&mut relay, 1);
    let elsewhere = |e: &Endpoint| e.username == "carol";
    let forged = relay.from_client(1, "i1", 1, &IhttpFrameKind::End, elsewhere, NOW);
    assert_eq!(forged, Err(RelayFault::Misaddressed));
    let cancelled = relay.from_server(2, "i1", id, &cancel(), elsewhere, NOW);
    assert_eq!(cancelled, Err(RelayFault::Misaddressed));
    // Neither the End nor the Cancel took: the caller's body is still in order.
    relay
        .from_client(1, "i1", 1, &body(1), any, NOW)
        .expect("alive");
    relay
        .from_client(1, "i1", 1, &IhttpFrameKind::End, any, NOW)
        .expect("own end");
}

#[test]
fn a_caller_s_stream_ids_only_increase() {
    let mut relay = IhttpRelay::default();
    opened(&mut relay, 5);
    let older = relay.open(end(1, "alice"), 3, end(2, "bob"), None, NOW);
    assert_eq!(older, Err(RelayFault::StreamId));
    relay
        .from_client(1, "i1", 5, &cancel(), any, NOW)
        .expect("close 5");
    let reused = relay.open(end(1, "alice"), 5, end(2, "bob"), None, NOW);
    assert_eq!(
        reused,
        Err(RelayFault::StreamId),
        "a closed id is not reused"
    );
    opened(&mut relay, 6);
    // Another caller, or the same caller's other install, counts from scratch.
    let carol = relay.open(end(3, "carol"), 1, end(2, "bob"), None, NOW);
    assert!(carol.is_ok());
}

#[test]
fn bodies_and_credit_extend_the_deadline_up_to_the_streaming_ceiling() {
    let mut relay = IhttpRelay::default();
    let id = opened(&mut relay, 1);
    let later = NOW + STREAM_TIMEOUT_MS - 1;
    relay
        .from_client(1, "i1", 1, &body(1), any, later)
        .expect("body");
    let past_first = NOW + STREAM_TIMEOUT_MS + 1;
    relay
        .from_client(1, "i1", 1, &body(1), any, past_first)
        .expect("extended");
    let ceiling = NOW + STREAMING_TIMEOUT_MS;
    relay.expire(ceiling - 1);
    assert!(relay.take_records().iter().all(|r| r.closed.is_none()));
    relay.expire(ceiling);
    let records = relay.take_records();
    assert_eq!(records.len(), 1);
    assert_eq!(records[0].closed, Some(CloseReason::Timeout));
    assert_eq!((records[0].stream, records[0].client_stream), (id, 1));
    assert_eq!((records[0].client.cid, records[0].server.cid), (1, 2));
}

#[test]
fn every_open_and_close_is_recorded_with_its_bytes_and_time() {
    let mut relay = IhttpRelay::default();
    let id = opened(&mut relay, 1);
    relay
        .from_client(1, "i1", 1, &body(3), any, NOW)
        .expect("body");
    relay
        .from_client(1, "i1", 1, &IhttpFrameKind::End, any, NOW)
        .expect("end");
    relay
        .from_server(2, "i1", id, &head(), any, NOW)
        .expect("head");
    relay
        .from_server(2, "i1", id, &body(4), any, NOW + 5)
        .expect("body");
    relay
        .from_server(2, "i1", id, &IhttpFrameKind::End, any, NOW + 7)
        .expect("end");
    let records = relay.take_records();
    let lines: Vec<String> = records.iter().map(audit_line).collect();
    let tail = format!("app=com.acme.kanban install=i1 via=relay stream={id}");
    assert_eq!(
        lines,
        [
            format!("[APPS-IHTTP] open from=alice#1 to=bob#2 {tail} bytes=0 ms=0 reason=-"),
            format!("[APPS-IHTTP] close from=alice#1 to=bob#2 {tail} bytes=7 ms=7 reason=ended"),
        ]
    );
    assert!(relay.take_records().is_empty(), "taken once");
    opened(&mut relay, 2);
    relay
        .from_client(1, "i1", 2, &cancel(), any, NOW)
        .expect("cancel");
    let cancelled = relay.take_records().pop().expect("closed");
    assert!(audit_line(&cancelled).ends_with("reason=cancel:Caller"));
    opened(&mut relay, 3);
    relay.forget_session(2);
    let ended = relay.take_records().pop().expect("closed");
    assert_eq!(ended.closed, Some(CloseReason::Session));
}
