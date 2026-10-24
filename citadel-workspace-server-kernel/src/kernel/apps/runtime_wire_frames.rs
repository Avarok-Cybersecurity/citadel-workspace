//! TEST: the internal-HTTP half of the shared runtime-wire fixture. A frame has two encodings:
//! the guest ABI's (`citadel_app_sdk_types::calls::IhttpFrame`, what an app hands the page) and
//! the wire's (`citadel_ihttp_types::IhttpFrame`, what the kernel relays and a peer's agent
//! reads). The page translates between them; these pairs say what each frame must become, both
//! encoded here by the crates that read them.

use super::ihttp_relay::RELAY_STREAM_BIT;
use citadel_app_sdk_types::calls::{
    FrameKind, HttpMethod, IhttpFrame as SdkFrame, RequestHead, ResponseHead,
};
use citadel_app_sdk_types::{encode, Bytes};
use citadel_ihttp_types::{CancelReason, IhttpFrame, IhttpFrameKind, IhttpHeader, IhttpMethod};
use serde_json::{json, Value};

const APP: &str = "com.acme.kanban";

fn pair(name: &str, stream: u64, sdk: FrameKind, wire: IhttpFrameKind) -> Value {
    let wire_bytes = citadel_ihttp_types::encode(&IhttpFrame {
        v: 1,
        stream,
        kind: wire,
    })
    .expect("a frame the wire takes");
    citadel_ihttp_types::decode(&wire_bytes).expect("a frame the wire reads");
    json!({
        "name": name,
        "sdk_hex": hex::encode(encode(&SdkFrame::new(stream, sdk))),
        "wire_hex": hex::encode(wire_bytes),
    })
}

fn header(name: &str, value: &str) -> IhttpHeader {
    IhttpHeader {
        name: name.into(),
        value: value.into(),
    }
}

fn sdk_head(query: &str, headers: Vec<(String, String)>, body_len: Option<u64>) -> FrameKind {
    FrameKind::RequestHead(RequestHead {
        method: HttpMethod::Post,
        path: "/cards/7".into(),
        query: query.into(),
        headers,
        body_len,
        app_id: APP.into(),
        scope_key: "workspace".into(),
    })
}

fn wire_head(
    query: Option<&str>,
    headers: Vec<IhttpHeader>,
    body_len: Option<u64>,
) -> IhttpFrameKind {
    IhttpFrameKind::RequestHead {
        method: IhttpMethod::Post,
        path: "/cards/7".into(),
        query: query.map(str::to_string),
        headers,
        body_len,
        app_id: APP.into(),
        scope_key: "workspace".into(),
    }
}

fn response(headers: Vec<(String, String)>) -> FrameKind {
    FrameKind::ResponseHead(ResponseHead {
        status: 201,
        headers,
        body_len: Some(2),
    })
}

fn wire_response() -> IhttpFrameKind {
    IhttpFrameKind::ResponseHead {
        status: 201,
        headers: vec![header("content-type", "text/plain")],
        body_len: Some(2),
    }
}

fn cancel(reason: &str) -> FrameKind {
    FrameKind::Cancel {
        reason: reason.into(),
    }
}

fn wire_cancel(reason: CancelReason) -> IhttpFrameKind {
    IhttpFrameKind::Cancel { reason }
}

fn common() -> Vec<Value> {
    let relay = RELAY_STREAM_BIT | 5;
    vec![
        pair(
            "a request head with no query, headers or known length",
            1,
            sdk_head("", vec![], None),
            wire_head(None, vec![], None),
        ),
        pair(
            "a body",
            1,
            FrameKind::Body {
                bytes: Bytes(vec![1, 2, 3]),
            },
            IhttpFrameKind::Body {
                bytes: vec![1, 2, 3],
            },
        ),
        pair("end", relay, FrameKind::End, IhttpFrameKind::End),
        pair(
            "credit",
            relay,
            FrameKind::Credit { n: 1 },
            IhttpFrameKind::Credit { n: 1 },
        ),
    ]
}

/// What the page sends: header names lowercased (the wire takes no other), an empty query as
/// none, and its own cancel reasons narrowed to the wire's closed set; an app's own words are
/// `Caller`, never a guess.
pub(super) fn to_wire() -> Value {
    let mixed = vec![("Content-Type".to_string(), "text/plain".to_string())];
    let lower = || vec![header("content-type", "text/plain")];
    let mut cases = common();
    cases.extend([
        pair(
            "a request head",
            2,
            sdk_head("q=1", mixed.clone(), Some(5)),
            wire_head(Some("q=1"), lower(), Some(5)),
        ),
        pair(
            "a response head on a relay stream",
            RELAY_STREAM_BIT | 9,
            response(mixed),
            wire_response(),
        ),
        pair(
            "cancel: timeout",
            3,
            cancel("timeout"),
            wire_cancel(CancelReason::Timeout),
        ),
        pair(
            "cancel: rate",
            3,
            cancel("rate"),
            wire_cancel(CancelReason::RateLimited),
        ),
        pair(
            "cancel: unrouted",
            3,
            cancel("unrouted"),
            wire_cancel(CancelReason::NoRoute),
        ),
        pair(
            "cancel: server busy",
            3,
            cancel("server_concurrency"),
            wire_cancel(CancelReason::Busy),
        ),
        pair(
            "cancel: caller busy",
            3,
            cancel("caller_concurrency"),
            wire_cancel(CancelReason::Busy),
        ),
        pair(
            "cancel: a chunk too large",
            3,
            cancel("chunk_too_large"),
            wire_cancel(CancelReason::TooLarge),
        ),
        pair(
            "cancel: a body past its length",
            3,
            cancel("body_longer_than_declared"),
            wire_cancel(CancelReason::TooLarge),
        ),
        pair(
            "cancel: an unknown stream",
            3,
            cancel("unknown_stream"),
            wire_cancel(CancelReason::Protocol),
        ),
        pair(
            "cancel: a stale stream id",
            3,
            cancel("stream_id"),
            wire_cancel(CancelReason::Protocol),
        ),
        pair(
            "cancel: an app's own words are the caller's",
            3,
            cancel("anything else"),
            wire_cancel(CancelReason::Caller),
        ),
    ]);
    Value::Array(cases)
}

/// What the page reads: the wire's frames in the guest ABI's shapes.
pub(super) fn from_wire() -> Value {
    let lower = || vec![("content-type".to_string(), "text/plain".to_string())];
    let mut cases = common();
    cases.extend([
        pair(
            "a request head on a relay stream",
            RELAY_STREAM_BIT | 1,
            sdk_head("q=1", lower(), Some(5)),
            wire_head(
                Some("q=1"),
                vec![header("content-type", "text/plain")],
                Some(5),
            ),
        ),
        pair("a response head", 2, response(lower()), wire_response()),
    ]);
    let reasons = [
        ("caller", CancelReason::Caller),
        ("timeout", CancelReason::Timeout),
        ("too_large", CancelReason::TooLarge),
        ("busy", CancelReason::Busy),
        ("rate_limited", CancelReason::RateLimited),
        ("no_route", CancelReason::NoRoute),
        ("refused", CancelReason::Refused),
        ("failed", CancelReason::Failed),
        ("closed", CancelReason::Closed),
        ("protocol", CancelReason::Protocol),
        ("unavailable", CancelReason::Unavailable),
    ];
    for (text, reason) in reasons {
        cases.push(pair(
            &format!("cancel: {text}"),
            3,
            cancel(text),
            wire_cancel(reason),
        ));
    }
    Value::Array(cases)
}
