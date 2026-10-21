//! Every fixture's run, in the reference host, as fixtures.json states.

use app_fixture_harness::host::{Instance, Limits, Trap};
use app_fixture_harness::{caps, context, manifest, wasm};
use citadel_app_abi_inspect::inspect;
use citadel_app_sdk_types::calls::DrawCommand;
use citadel_app_sdk_types::ops::CanvasOps;
use citadel_app_sdk_types::{AppEvent, HostCall};
use serde_json::Value;

/// Generous for every well-behaved call here, finite for an endless loop.
const FUEL: u64 = 20_000_000;
/// A request or reply cap no fixture's legitimate call approaches, unless the run states one.
const DEFAULT_IO_BYTES: u32 = 1 << 20;

fn start(name: &str, run: &Value) -> Instance {
    let bytes = wasm(name);
    let initial = inspect(&bytes).unwrap().memory().unwrap().initial_pages as u32;
    let host = &run["host"];
    let limits = Limits {
        max_memory_pages: host["max_memory_pages"].as_u64().unwrap() as u32,
        max_request_bytes: DEFAULT_IO_BYTES,
        max_reply_bytes: host["max_reply_bytes"]
            .as_u64()
            .map_or(DEFAULT_IO_BYTES, |n| n as u32),
        fuel_per_call: FUEL,
    };
    Instance::new(&bytes, initial, &caps(&run["granted"]), limits)
}

fn expect_init(name: &str, inst: &mut Instance, run: &Value) {
    let got = inst.init(&context(&caps(&run["granted"])));
    match &run["init"] {
        Value::String(s) if s == "trap" => {
            assert!(matches!(got, Err(Trap::Other(_))), "{name}: {got:?}")
        }
        n => assert_eq!(
            got,
            Ok(n.as_i64().unwrap() as i32),
            "{name} init; log {:?}",
            inst.state().log
        ),
    }
}

fn play(name: &str, run: &Value) -> Instance {
    let mut inst = start(name, run);
    expect_init(name, &mut inst, run);
    if run["init"] != "trap" {
        assert_eq!(
            inst.pump(),
            Ok(()),
            "{name}: delivering pending replies after init"
        );
    }
    for step in run["events"].as_array().into_iter().flatten() {
        let event: AppEvent = serde_json::from_value(step["event"].clone()).unwrap();
        let got = inst.event(&event).and_then(|()| inst.pump());
        match step["outcome"].as_str().unwrap() {
            "ok" => assert_eq!(got, Ok(()), "{name} {event:?}"),
            _ => assert!(got.is_err(), "{name} {event:?} should trap"),
        }
    }
    match run["frame"].as_str() {
        Some("ok") => assert_eq!(inst.frame(16), Ok(())),
        Some(_) => assert_eq!(inst.frame(16), Err(Trap::OutOfFuel), "{name} frame"),
        None => {}
    }
    let report = inst.report();
    for (probe, want) in run["report"].as_object().into_iter().flatten() {
        assert_eq!(
            report.get(probe).map(String::as_str),
            want.as_str(),
            "{name}: {probe}; report {report:?}"
        );
    }
    if let Some(pages) = run["memory_pages_after"].as_u64() {
        assert_eq!(inst.memory_pages(), pages, "{name} memory");
    }
    if let Some(needle) = run["log_contains"].as_str() {
        assert!(
            inst.state().log.iter().any(|l| l.contains(needle)),
            "{name}: {:?}",
            inst.state().log
        );
    }
    for line in run["log"].as_array().into_iter().flatten() {
        assert!(
            inst.state().log.iter().any(|l| l == line.as_str().unwrap()),
            "{name}: {:?}",
            inst.state().log
        );
    }
    inst
}

#[test]
fn every_fixture_runs_as_fixtures_json_says() {
    let m = manifest();
    let mut ran = 0;
    for (name, f) in m["fixtures"].as_object().unwrap() {
        for key in ["run", "control_run"] {
            if let Some(run) = f.get(key) {
                play(name, run);
                ran += 1;
            }
        }
    }
    assert!(ran >= 8, "only {ran} runs");
}

#[test]
fn hello_canvas_paints_a_card_the_size_of_its_canvas() {
    let m = manifest();
    let inst = play("hello-canvas", &m["fixtures"]["hello-canvas"]["run"]);
    let draws: Vec<&Vec<DrawCommand>> = inst
        .state()
        .calls
        .iter()
        .filter_map(|c| match c {
            HostCall::Canvas(CanvasOps::CanvasDraw(d)) => Some(&d.commands),
            _ => None,
        })
        .collect();
    assert_eq!(draws.len(), 1);
    assert!(matches!(draws[0][1], DrawCommand::FillRect { w, h, .. } if w == 300.0 && h == 180.0));
}

#[test]
fn exfil_reports_every_probe_and_nothing_left_the_sandbox() {
    let m = manifest();
    let run = &m["fixtures"]["exfil-attempts"]["run"];
    let inst = play("exfil-attempts", run);
    let want: Vec<&String> = run["report"].as_object().unwrap().keys().collect();
    let got = inst.report();
    assert_eq!(
        got.keys().collect::<Vec<_>>().len(),
        want.len(),
        "a probe is missing or extra: {got:?}"
    );
    let reached: Vec<&HostCall> = inst
        .state()
        .calls
        .iter()
        .filter(|c| !matches!(c, HostCall::Log(_) | HostCall::Navigate(_)))
        .collect();
    assert!(
        reached.is_empty(),
        "the host decoded a call it should have refused unread: {reached:?}"
    );
}

#[test]
fn a_pending_reply_reaches_the_app_only_through_reply_ready() {
    let m = manifest();
    let run = &m["fixtures"]["huge-reply"]["run"];
    let mut inst = start("huge-reply", run);
    assert_eq!(inst.init(&context(&caps(&run["granted"]))), Ok(0));
    assert!(
        inst.report().is_empty(),
        "every read is pending until delivered: {:?}",
        inst.report()
    );
    inst.pump().unwrap();
    assert_eq!(inst.report().len(), 3);
}
