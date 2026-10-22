//! A manifest's limits, artifact and previous versions, each refusal beside the valid fixture it
//! changes one thing of.

mod apps_fixture;

use apps_fixture::with;
use citadel_workspace_types::apps_manifest::ManifestRefusal as R;
use serde_json::json;

#[test]
fn limits_are_clamped_to_the_host_ceilings() {
    for (field, value) in [
        ("memory_pages", 0),
        ("memory_pages", 4097),
        ("max_call_rate_per_s", 0),
        ("max_call_rate_per_s", 201),
        ("frame_budget_ms", 0),
        ("frame_budget_ms", 1001),
        ("storage_user_bytes", 1024 * 1024 + 1),
        ("storage_scope_bytes", 8 * 1024 * 1024 + 1),
    ] {
        let refused = with(|m| m["limits"][field] = json!(value));
        assert_eq!(
            refused.unwrap_err(),
            R::Limits(field.to_string()),
            "{field}={value}"
        );
    }
    assert!(with(|m| m["limits"]["memory_pages"] = json!(4096)).is_ok());
}

#[test]
fn the_artifact() {
    let refused = |change: &dyn Fn(&mut serde_json::Value)| {
        matches!(with(|m| change(m)), Err(R::Artifact(_)))
    };
    assert!(refused(&|m| m["artifact"]["sha256"] = json!("A".repeat(64))));
    assert!(refused(&|m| m["artifact"]["sha256"] = json!("0".repeat(63))));
    assert!(refused(&|m| m["artifact"]["bytes"] = json!(0)));
    assert!(refused(
        &|m| m["artifact"]["bytes"] = json!(8 * 1024 * 1024 + 1)
    ));
    assert!(refused(&|m| m["artifact"]["locations"] = json!([])));
    assert!(refused(
        &|m| m["artifact"]["locations"][0] =
            json!({ "kind": "https", "url": "http://acme.example/app.wasm" })
    ));
    assert!(refused(
        &|m| m["artifact"]["locations"][1]["commit"] = json!("main")
    ));
    assert!(refused(
        &|m| m["artifact"]["locations"][1]["path"] = json!("../app.wasm")
    ));
    assert!(refused(
        &|m| m["artifact"]["locations"][1]["path"] = json!("/dist/app.wasm")
    ));
    assert!(refused(
        &|m| m["artifact"]["locations"][1]["repo"] = json!("acme")
    ));
    assert!(refused(&|m| {
        let first = m["artifact"]["locations"][0].clone();
        m["artifact"]["locations"][1] = first;
    }));
    assert!(matches!(
        with(|m| m["artifact"]["locations"][0] = json!({ "kind": "ipfs", "cid": "x" })),
        Err(R::Json(_))
    ));
}

#[test]
fn previous_versions_are_lower_and_distinct() {
    for previous in [
        json!(["1.4.0"]),
        json!(["1.5.0"]),
        json!(["1.3.2", "1.3.2"]),
        json!(["1.3"]),
    ] {
        assert_eq!(
            with(|m| m["previous_versions"] = previous).unwrap_err(),
            R::PreviousVersions
        );
    }
    assert!(with(|m| m["previous_versions"] = json!(["0.9.0", "1.3.2"])).is_ok());
}
