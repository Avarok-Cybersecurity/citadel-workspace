//! The inspector over every committed fixture, as fixtures.json states, with controls.

use app_fixture_harness::{caps, manifest, wasm};
use citadel_app_abi_inspect::{check, inspect, Policy, Rejection, Verdict};
use citadel_app_sdk_types::{Capability, Group};
use std::collections::BTreeSet;

/// The design's 256 MiB ceiling, in pages: generous, so only a fixture's own defect rejects it.
const CEILING_PAGES: u32 = 4096;

fn policy(declared: Vec<Capability>) -> Policy {
    Policy {
        declared,
        max_memory_pages: CEILING_PAGES,
    }
}

const EXPECTED: [&str; 10] = [
    "hello-canvas",
    "linker-start",
    "undeclared-import",
    "foreign-import",
    "over-memory",
    "slow-frame",
    "ungranted-calls",
    "panics",
    "huge-reply",
    "exfil-attempts",
];

#[test]
fn the_fixture_set_is_the_designed_one_and_every_wasm_is_committed() {
    let m = manifest();
    let names: BTreeSet<&str> = m["fixtures"]
        .as_object()
        .unwrap()
        .keys()
        .map(String::as_str)
        .collect();
    assert_eq!(names, EXPECTED.into_iter().collect());
    for name in EXPECTED {
        assert!(wasm(name).starts_with(b"\0asm"), "{name}");
    }
}

#[test]
fn every_fixture_is_judged_as_fixtures_json_says() {
    let m = manifest();
    for (name, f) in m["fixtures"].as_object().unwrap() {
        let v = check(&wasm(name), &policy(caps(&f["declared"])));
        let codes: BTreeSet<String> = v.reasons().iter().map(Rejection::code).collect();
        if f["inspect"]["accepted"] == true {
            assert!(v.is_accepted(), "{name}: {codes:?}");
        } else {
            let want: BTreeSet<String> = f["inspect"]["rejects"]
                .as_array()
                .unwrap()
                .iter()
                .map(|c| c.as_str().unwrap().into())
                .collect();
            assert_eq!(codes, want, "{name}");
        }
        if let Some(control) = f.get("control") {
            let v = check(&wasm(name), &policy(caps(&control["declared"])));
            assert!(v.is_accepted(), "{name}'s control: {:?}", v.reasons());
        }
    }
}

#[test]
fn the_linker_start_fixture_differs_from_its_control_only_by_the_start_function() {
    let hello = inspect(&wasm("hello-canvas")).unwrap();
    let start = inspect(&wasm("linker-start")).unwrap();
    assert!(!hello.has_start && start.has_start);
    assert_eq!(hello.imports, start.imports);
    assert_eq!(hello.exports, start.exports);
}

#[test]
fn hello_canvas_imports_exactly_what_it_uses() {
    let insp = inspect(&wasm("hello-canvas")).unwrap();
    let names: BTreeSet<&str> = insp.imports.iter().map(|i| i.name.as_str()).collect();
    assert_eq!(
        names,
        [
            "canvas",
            "events",
            "log",
            "memory",
            "reply_len",
            "reply_read"
        ]
        .into_iter()
        .collect()
    );
    assert!(insp.imports.iter().all(|i| i.module == "citadel_app_abi_1"));
}

#[test]
fn the_sdk_imports_each_granted_group_by_its_abi_name_and_nothing_else() {
    let insp = inspect(&wasm("ungranted-calls")).unwrap();
    let names: BTreeSet<&str> = insp.imports.iter().map(|i| i.name.as_str()).collect();
    let granted = Group::ALL
        .iter()
        .filter(|g| !Capability::INTRINSIC.iter().any(|c| c.group() == **g));
    let mut want: BTreeSet<&str> = granted.map(|g| g.import_name()).collect();
    want.extend(["memory", "reply_len", "reply_read", "log"]);
    assert_eq!(names, want);
    for name in EXPECTED.into_iter().filter(|n| *n != "foreign-import") {
        for i in inspect(&wasm(name)).unwrap().imports {
            assert_eq!(
                i.module, "citadel_app_abi_1",
                "{name} imports {}.{}",
                i.module, i.name
            );
        }
    }
}

#[test]
fn dropping_any_imported_group_from_a_manifest_rejects_the_fixture() {
    let m = manifest();
    for (name, f) in m["fixtures"].as_object().unwrap() {
        if f["inspect"]["accepted"] != true {
            continue;
        }
        let declared = caps(&f["declared"]);
        let insp = inspect(&wasm(name)).unwrap();
        let needs_grant = |g: &Group| !Capability::INTRINSIC.iter().any(|c| c.group() == *g);
        for group in insp
            .imports
            .iter()
            .filter_map(|i| Group::from_import_name(&i.name))
            .filter(needs_grant)
        {
            let fewer: Vec<Capability> = declared
                .iter()
                .copied()
                .filter(|c| c.group() != group)
                .collect();
            let v = check(&wasm(name), &policy(fewer));
            assert_eq!(
                v.reasons(),
                [Rejection::UndeclaredGroup { group }],
                "{name} without {group:?}"
            );
        }
    }
}

#[test]
fn a_ceiling_below_the_declared_minimum_rejects_and_the_minimum_itself_does_not() {
    let bytes = wasm("hello-canvas");
    let initial = inspect(&bytes).unwrap().memory().unwrap().initial_pages as u32;
    let declared = vec![Capability::Canvas, Capability::Events, Capability::Log];
    let low = check(
        &bytes,
        &Policy {
            declared: declared.clone(),
            max_memory_pages: initial - 1,
        },
    );
    assert_eq!(
        low.reasons(),
        [Rejection::MemoryInitialTooLarge {
            initial_pages: initial.into(),
            max_pages: initial - 1
        }]
    );
    let exact = check(
        &bytes,
        &Policy {
            declared,
            max_memory_pages: initial,
        },
    );
    assert!(matches!(exact, Verdict::Accepted(_)));
}
