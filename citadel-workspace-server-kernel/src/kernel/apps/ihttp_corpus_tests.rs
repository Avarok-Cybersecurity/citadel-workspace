//! The shared frame corpus, read back from the file: the wire crate's decoder and the
//! kernel's relay each make of every case what its `expect` says (ihttp_corpus.rs).

use super::ihttp_corpus::{document, CORPUS};
use super::test_ihttp::*;
use super::test_manifests::*;
use super::test_runtime::*;
use citadel_ihttp_types::{decode, FrameError, IhttpFrameKind};
use citadel_workspace_types::apps::InstallScope;
use citadel_workspace_types::apps_install::AppsRefusal;
use citadel_workspace_types::apps_responses::AppsResponse;
use std::path::PathBuf;

struct Read {
    name: String,
    bytes: Vec<u8>,
    expect: String,
}

fn path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(CORPUS)
}

fn corpus() -> Vec<Read> {
    let text = std::fs::read_to_string(path()).expect("read the frame corpus");
    let value: serde_json::Value = serde_json::from_str(&text).expect("json");
    let cases = value["cases"].as_array().expect("cases");
    assert!(cases.len() > 30, "the corpus lost its cases");
    cases
        .iter()
        .map(|c| Read {
            name: c["name"].as_str().expect("name").into(),
            bytes: hex::decode(c["hex"].as_str().expect("hex")).expect("hex"),
            expect: c["expect"].as_str().expect("expect").into(),
        })
        .collect()
}

/// The wire crate's verdict, in the corpus's words.
fn wire_verdict(bytes: &[u8]) -> String {
    match decode(bytes) {
        Ok(frame) => match frame.kind {
            IhttpFrameKind::RequestHead { .. } => "RequestHead".into(),
            IhttpFrameKind::ResponseHead { .. } => "ResponseHead".into(),
            IhttpFrameKind::Body { .. } => "Body".into(),
            IhttpFrameKind::End => "End".into(),
            IhttpFrameKind::Cancel { reason } => format!("Cancel({reason:?})"),
            IhttpFrameKind::Credit { .. } => "Credit".into(),
        },
        Err(FrameError::Malformed(_)) => "refused:Malformed".into(),
        Err(FrameError::Version(_)) => "refused:Version".into(),
        Err(other) => format!("refused:{other:?}"),
    }
}

#[test]
fn the_corpus_file_is_what_the_generator_writes() {
    let want = document();
    if std::env::var_os("CITADEL_WRITE_IHTTP_CORPUS").is_some() {
        std::fs::write(path(), &want).expect("write the frame corpus");
    }
    let have = std::fs::read_to_string(path()).expect("read the frame corpus");
    assert!(
        have == want,
        "{} is stale; regenerate it (ihttp_corpus.rs)",
        path().display()
    );
}

#[test]
fn the_wire_decoder_reads_every_case_as_the_corpus_says() {
    for case in corpus() {
        assert_eq!(wire_verdict(&case.bytes), case.expect, "case {}", case.name);
    }
}

/// Through the kernel's real `IhttpSend`, one relay for every case: a refused frame is
/// `Policy` before the relay sees it; any other frame reaches the relay, which opens the one
/// served head and finds no stream for the rest.
#[tokio::test]
async fn the_kernel_relays_exactly_the_frames_the_corpus_admits() {
    let kernel = workspace_serving(wasm(1, 4096)).await;
    let id = install(&kernel, "boss", InstallScope::Workspace, BOTH).await;
    assert!(matches!(
        advertise(&kernel, "bob", Some(BOB), &id).await,
        AppsResponse::Advertised { .. }
    ));
    for case in corpus() {
        let answer = send(&kernel, "alice", ALICE, &id, user("bob"), case.bytes).await;
        let got = match &answer {
            AppsResponse::IhttpSent => "sent",
            other => match refused(other) {
                Some(AppsRefusal::Policy) => "policy",
                Some(AppsRefusal::Unavailable) => "no stream",
                _ => panic!("case {}: {other:?}", case.name),
            },
        };
        let want = if case.expect.starts_with("refused:") {
            "policy"
        } else if case.expect == "RequestHead" {
            "sent"
        } else {
            "no stream"
        };
        assert_eq!(got, want, "case {}", case.name);
    }
}
