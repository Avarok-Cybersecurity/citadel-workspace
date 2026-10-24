//! The shared flow corpus (`apps/catalogue/fixtures/ihttp-flow-cases.json`), through the
//! kernel's `StreamFlow`: every step gets the verdict the corpus gives it. The page's router
//! reads the same file (host/__tests__/ihttp-flow-corpus.test.ts).

use super::ihttp_flow::{Side, StreamFlow};
use citadel_ihttp_types::{CancelReason, IhttpFrameKind};
use serde_json::Value;
use std::path::PathBuf;

const CORPUS: &str = "../apps/catalogue/fixtures/ihttp-flow-cases.json";

fn number(step: &Value, key: &str) -> u64 {
    step[key]
        .as_u64()
        .unwrap_or_else(|| panic!("{key} in {step}"))
}

fn kind(step: &Value) -> IhttpFrameKind {
    match step["kind"].as_str().expect("kind") {
        "End" => IhttpFrameKind::End,
        "Body" => IhttpFrameKind::Body {
            bytes: vec![0; number(step, "len") as usize],
        },
        "Credit" => IhttpFrameKind::Credit {
            n: number(step, "n") as u32,
        },
        "Cancel" => IhttpFrameKind::Cancel {
            reason: CancelReason::Caller,
        },
        "ResponseHead" => IhttpFrameKind::ResponseHead {
            status: 200,
            headers: vec![],
            body_len: step["body_len"].as_u64(),
        },
        other => panic!("an unknown step kind {other}"),
    }
}

#[test]
fn stream_flow_gives_every_step_the_corpus_verdict() {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(CORPUS);
    let text = std::fs::read_to_string(&path).expect("read the flow corpus");
    let corpus: Value = serde_json::from_str(&text).expect("json");
    let cases = corpus["cases"].as_array().expect("cases");
    assert!(cases.len() >= 10, "the flow corpus lost its cases");
    for case in cases {
        let name = case["name"].as_str().expect("name");
        let mut flow = StreamFlow::opened(case["body_len"].as_u64());
        for (i, step) in case["steps"].as_array().expect("steps").iter().enumerate() {
            let side = match step["from"].as_str().expect("from") {
                "client" => Side::Client,
                "server" => Side::Server,
                other => panic!("{name}: an unknown side {other}"),
            };
            let verdict = match flow.admit(side, &kind(step)) {
                Ok(()) => "ok",
                Err(_) => "fault",
            };
            assert_eq!(
                verdict,
                step["expect"].as_str().expect("expect"),
                "{name}, step {i}"
            );
        }
    }
}
