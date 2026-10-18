//! The server's target rule and the UI's mirror of it (`citadel-workspaces/src/lib/share/
//! target-rules.ts`) give every case in one shared fixture the same verdict. The UI suite reads
//! the same file, so a rule changed on one side only turns that side's suite red.

use citadel_workspace_server_kernel::kernel::secure_links::target::validate_target;
use serde_json::Value;
use std::path::Path;

const FIXTURE: &str = "../citadel-workspace-types/fixtures/secure-link-targets.json";

fn target_of(case: &Value) -> String {
    let mut target = case["target"]
        .as_str()
        .expect("a case has a target")
        .to_string();
    if let Some(pad_to) = case.get("padTo") {
        let pad_to = usize::try_from(pad_to.as_u64().expect("padTo is a byte count"))
            .expect("padTo fits in usize");
        assert!(target.len() <= pad_to, "padTo is shorter than {target:?}");
        target.push_str(&"a".repeat(pad_to - target.len()));
    }
    target
}

#[test]
fn every_shared_case_gets_its_verdict() {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join(FIXTURE);
    let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{path:?}: {e}"));
    let fixture: Value = serde_json::from_str(&text).expect("the fixture is JSON");
    let cases = fixture["cases"].as_array().expect("the fixture has cases");
    assert!(cases.len() > 40, "only {} cases", cases.len());
    let wrong: Vec<String> = cases
        .iter()
        .filter_map(|case| {
            let target = target_of(case);
            let accepted = case["accepted"].as_bool().expect("a case has a verdict");
            let verdict = validate_target(&target);
            (verdict.is_ok() != accepted).then(|| {
                format!(
                    "{:?} ({}): expected {}, got {verdict:?}",
                    target.chars().take(80).collect::<String>(),
                    case["reason"].as_str().unwrap_or("no reason"),
                    if accepted { "accepted" } else { "refused" },
                )
            })
        })
        .collect();
    assert!(
        wrong.is_empty(),
        "verdicts that disagree:\n{}",
        wrong.join("\n")
    );
}
