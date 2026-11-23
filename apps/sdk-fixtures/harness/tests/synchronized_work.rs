//! The committed synchronized.work module (apps/first-party/synchronized-work) in the reference
//! host: the inspector accepts it against its manifest, and its first run picks its transport by
//! the grant: `citadel.session` granted opens a session to synchronized.work and draws a frame;
//! without it and with `net.host`, it long-polls over HTTPS with no WebSocket header. Each run's
//! grant is the other's control.

use app_fixture_harness::host::{Instance, Limits};
use app_fixture_harness::{caps, fixtures_dir};
use citadel_app_abi_inspect::{check, inspect, Policy};
use citadel_app_sdk_types::calls::{HttpMethod, HttpRequest, SessionOpen};
use citadel_app_sdk_types::ops::{CanvasOps, NetOps, SessionOps};
use citadel_app_sdk_types::{AppContext, AppScope, Capability, HostCall, Size, Surface};
use serde_json::Value;
use std::path::PathBuf;

const FUEL: u64 = 200_000_000;
const IO_BYTES: u32 = 1 << 20;
const NODE: &str = "n-1";

fn dir() -> PathBuf {
    fixtures_dir().join("../first-party/synchronized-work")
}

fn manifest() -> Value {
    let text = std::fs::read_to_string(dir().join("manifest.json")).unwrap();
    serde_json::from_str(&text).unwrap()
}

fn module() -> Vec<u8> {
    std::fs::read(dir().join("wasm/synchronized-work.wasm"))
        .expect("run `node scripts/build-first-party-apps.mjs`")
}

fn memory_pages() -> u32 {
    manifest()["limits"]["memory_pages"].as_u64().unwrap() as u32
}

#[test]
fn the_inspector_accepts_the_module_against_its_manifest() {
    let declared: Vec<Value> = manifest()["capabilities"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| c["cap"].clone())
        .collect();
    let policy = Policy {
        declared: caps(&Value::Array(declared)),
        max_memory_pages: memory_pages(),
    };
    let verdict = check(&module(), &policy);
    assert!(verdict.is_accepted(), "{:?}", verdict.reasons());
}

fn context(granted: &[Capability]) -> AppContext {
    AppContext {
        app_id: manifest()["id"].as_str().unwrap().into(),
        install_id: "install-1".into(),
        scope: AppScope::Node {
            node_id: NODE.into(),
        },
        granted: granted.to_vec(),
        surface: Surface::NodePage {},
        size: Size {
            width: 800,
            height: 600,
        },
        dpr: 1.0,
        theme: Default::default(),
        locale: "en".into(),
        acting_username: "alice".into(),
        node_id: NODE.into(),
        close_grace_ms: 500,
        sdk_abi_minor: 1,
    }
}

/// `app_init` as a node page, the start, and every reply settled; the calls it made.
fn run(granted: &[Capability], seed: Option<(&str, Vec<u8>)>) -> Vec<HostCall> {
    let wasm = module();
    let initial = inspect(&wasm).unwrap().memory().unwrap().initial_pages as u32;
    let limits = Limits {
        max_memory_pages: memory_pages(),
        max_request_bytes: IO_BYTES,
        max_reply_bytes: IO_BYTES,
        fuel_per_call: FUEL,
        close_grace_fuel: FUEL,
        ihttp_remote: None,
    };
    let mut inst = Instance::new(&wasm, initial, granted, limits);
    if let Some((key, value)) = seed {
        inst.seed_user_kv(key, value);
    }
    let log = |i: &Instance| i.state().log.clone();
    assert_eq!(inst.init(&context(granted)), Ok(0), "{:?}", log(&inst));
    assert_eq!(inst.pump(), Ok(()));
    assert_eq!(inst.start(), Ok(()), "{:?}", log(&inst));
    assert_eq!(inst.pump(), Ok(()), "{:?}", log(&inst));
    inst.state().calls.clone()
}

fn session_opens(calls: &[HostCall]) -> Vec<&SessionOpen> {
    calls
        .iter()
        .filter_map(|c| match c {
            HostCall::Session(SessionOps::SessionOpen(o)) => Some(o),
            _ => None,
        })
        .collect()
}

fn fetches(calls: &[HostCall]) -> Vec<&HttpRequest> {
    calls
        .iter()
        .filter_map(|c| match c {
            HostCall::Net(NetOps::HostFetchOpen(f)) => Some(&f.request),
            _ => None,
        })
        .collect()
}

fn drew(calls: &[HostCall]) -> bool {
    calls
        .iter()
        .any(|c| matches!(c, HostCall::Canvas(CanvasOps::CanvasDraw(d)) if !d.commands.is_empty()))
}

#[test]
fn with_citadel_session_granted_it_draws_and_opens_a_session_to_synchronized_work() {
    let calls = run(&[Capability::CitadelSession, Capability::StorageUser], None);
    assert!(drew(&calls), "{calls:?}");
    let opens = session_opens(&calls);
    assert_eq!(opens.len(), 1, "{calls:?}");
    assert_eq!(opens[0].server, "synchronized.work");
    assert!(fetches(&calls).is_empty(), "{calls:?}");
}

/// What `storage.user` holds for a page linked to project `p-1`: `sw-app-core`'s `LinkRecord`
/// (canonical CBOR `{"v": 1, "project": "p-1"}`) under `sw-link/<node>`.
fn linked_record() -> (String, Vec<u8>) {
    let mut cbor = vec![0xa2, 0x61, b'v', 0x01, 0x67];
    cbor.extend_from_slice(b"project");
    cbor.extend_from_slice(&[0x63, b'p', b'-', b'1']);
    (format!("sw-link/{NODE}"), cbor)
}

#[test]
fn with_only_net_host_it_long_polls_over_https_with_no_websocket_header() {
    let (key, record) = linked_record();
    let granted = [Capability::NetHost, Capability::StorageUser];
    let calls = run(&granted, Some((&key, record)));
    assert!(session_opens(&calls).is_empty(), "{calls:?}");
    let requests = fetches(&calls);
    assert_eq!(requests.len(), 1, "{calls:?}");
    let r = requests[0];
    assert_eq!(r.method, HttpMethod::Get);
    let url = "https://synchronized.work/v1/projects/p-1/stream?cursor=0&max_ms=25000";
    assert_eq!(r.url, url);
    assert!(r.body.0.is_empty());
    for (name, _) in &r.headers {
        let lower = name.to_ascii_lowercase();
        let forbidden = lower == "upgrade" || lower == "connection" || lower.starts_with("sec-");
        assert!(!forbidden, "{name}");
    }
    assert!(drew(&calls), "{calls:?}");
}
