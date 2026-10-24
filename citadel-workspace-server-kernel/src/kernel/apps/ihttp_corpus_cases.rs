//! The frame corpus's cases (ihttp_corpus.rs): each one's bytes and its hand-written verdict.

use super::ihttp_corpus::{case, frame, head_with, raw, served_head, set_path, Case, REASONS};
use citadel_ihttp_types::{IhttpFrame, IhttpFrameKind, IhttpHeader, MAX_BODY_CHUNK_BYTES};
use serde::Serialize;

#[derive(Serialize)]
struct Shaped<K: Serialize> {
    v: u8,
    stream: u64,
    kind: K,
}

#[derive(Serialize)]
enum Unknown {
    Push { x: u8 },
}

#[derive(Serialize)]
struct NoStream {
    v: u8,
    kind: &'static str,
}

#[derive(Serialize)]
struct TextStream {
    v: u8,
    stream: &'static str,
    kind: &'static str,
}

#[derive(Serialize)]
struct Extra {
    v: u8,
    stream: u64,
    kind: &'static str,
    caller: &'static str,
}

#[derive(Serialize)]
enum Teapot {
    Cancel { reason: &'static str },
}

pub(super) fn cases() -> Vec<Case> {
    let ok = |name: &str, kind: IhttpFrameKind, expect: &str| {
        case(name, raw(&frame(kind)), expect, "shape")
    };
    let mut all = vec![
        ok("end", IhttpFrameKind::End, "End"),
        ok("credit", IhttpFrameKind::Credit { n: 4 }, "Credit"),
        ok(
            "body",
            IhttpFrameKind::Body {
                bytes: vec![1, 2, 3],
            },
            "Body",
        ),
        // Stream 2, the only head: the kernel replays every case through one relay, and
        // the other frames, on stream 1, must find no stream rather than this one.
        case(
            "request_head",
            raw(&IhttpFrame {
                v: 1,
                stream: 2,
                kind: served_head(),
            }),
            "RequestHead",
            "shape",
        ),
        ok(
            "response_head",
            IhttpFrameKind::ResponseHead {
                status: 200,
                headers: vec![IhttpHeader {
                    name: "content-type".into(),
                    value: "application/json".into(),
                }],
                body_len: None,
            },
            "ResponseHead",
        ),
    ];
    for reason in REASONS {
        let name = format!("cancel_{reason:?}").to_lowercase();
        all.push(ok(
            &name,
            IhttpFrameKind::Cancel { reason },
            &format!("Cancel({reason:?})"),
        ));
    }
    let mut trailing = raw(&frame(IhttpFrameKind::End));
    trailing.push(0);
    let shape = |name: &str, bytes: Vec<u8>| case(name, bytes, "refused:Malformed", "shape");
    all.extend([
        shape("empty", vec![]),
        shape("not_cbor", vec![0xff]),
        shape("not_a_map", raw(&"End")),
        shape(
            "unknown_kind",
            raw(&Shaped {
                v: 1,
                stream: 1,
                kind: Unknown::Push { x: 1 },
            }),
        ),
        shape("missing_stream", raw(&NoStream { v: 1, kind: "End" })),
        shape(
            "stream_as_text",
            raw(&TextStream {
                v: 1,
                stream: "1",
                kind: "End",
            }),
        ),
        shape(
            "unknown_reason",
            raw(&Shaped {
                v: 1,
                stream: 1,
                kind: Teapot::Cancel { reason: "Teapot" },
            }),
        ),
        shape("trailing_byte", trailing),
    ]);
    let rules = |name: &str, bytes: Vec<u8>, expect: &str| case(name, bytes, expect, "rules");
    let mut v2 = frame(IhttpFrameKind::End);
    v2.v = 2;
    all.extend([
        rules("version_2", raw(&v2), "refused:Version"),
        rules(
            "extra_field",
            raw(&Extra {
                v: 1,
                stream: 1,
                kind: "End",
                caller: "alice",
            }),
            "refused:Malformed",
        ),
        rules(
            "dot_segment",
            raw(&head_with(|k| set_path(k, "/a/../b"))),
            "refused:Path",
        ),
        rules(
            "relative_path",
            raw(&head_with(|k| set_path(k, "cards"))),
            "refused:Path",
        ),
        rules(
            "framing_header",
            raw(&head_with(|k| {
                if let IhttpFrameKind::RequestHead { headers, .. } = k {
                    headers.push(IhttpHeader {
                        name: "host".into(),
                        value: "evil".into(),
                    });
                }
            })),
            "refused:Headers",
        ),
        rules(
            "bad_app_id",
            raw(&head_with(|k| {
                if let IhttpFrameKind::RequestHead { app_id, .. } = k {
                    *app_id = "Not An Id".into();
                }
            })),
            "refused:AppId",
        ),
        rules(
            "empty_scope_key",
            raw(&head_with(|k| {
                if let IhttpFrameKind::RequestHead { scope_key, .. } = k {
                    scope_key.clear();
                }
            })),
            "refused:ScopeKey",
        ),
        rules(
            "status_99",
            raw(&frame(IhttpFrameKind::ResponseHead {
                status: 99,
                headers: vec![],
                body_len: None,
            })),
            "refused:Status",
        ),
        rules(
            "credit_0",
            raw(&frame(IhttpFrameKind::Credit { n: 0 })),
            "refused:Credit",
        ),
        rules(
            "empty_body",
            raw(&frame(IhttpFrameKind::Body { bytes: vec![] })),
            "refused:Body",
        ),
        rules(
            "oversize",
            raw(&frame(IhttpFrameKind::Body {
                bytes: vec![7; MAX_BODY_CHUNK_BYTES + 8 * 1024],
            })),
            "refused:TooLarge",
        ),
    ]);
    all
}
