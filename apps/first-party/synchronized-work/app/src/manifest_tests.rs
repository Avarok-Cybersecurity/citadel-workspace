//! The manifest says what the pinned `sw-app` compiles with (SSOT across the two repositories):
//! the id, the `citadel.session` server, the `net.host` host and `limits.session`. The host
//! enforces the manifest; the app sizes and paces itself by its constants; they must agree.

use serde_json::{json, Value};
use sw_app::config;

fn manifest() -> Value {
    serde_json::from_str(include_str!("../../manifest.json")).unwrap()
}

fn capability(m: &Value, cap: &str) -> Value {
    let caps = m["capabilities"].as_array().unwrap();
    let found = caps.iter().find(|c| c["cap"] == cap);
    found.unwrap_or_else(|| panic!("no {cap}")).clone()
}

#[test]
fn the_manifest_names_the_id_server_host_and_session_limits_sw_app_runs_with() {
    let m = manifest();
    assert_eq!(m["id"], config::APP_ID);
    assert_eq!(
        capability(&m, "citadel.session")["servers"],
        json!([config::SERVER])
    );
    assert_eq!(
        capability(&m, "net.host")["hosts"],
        json!([config::POLL_HOST])
    );
    let session = &m["limits"]["session"];
    assert_eq!(
        session["max_msg_bytes"],
        json!(config::SESSION.max_msg_bytes)
    );
    assert_eq!(
        session["max_msgs_per_s"],
        json!(config::SESSION.max_msgs_per_s)
    );
}

#[test]
fn the_manifest_asks_for_what_the_app_calls_and_nothing_this_build_does_not() {
    let m = manifest();
    let caps: Vec<&str> = m["capabilities"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| c["cap"].as_str().unwrap())
        .collect();
    let want = [
        "canvas",
        "citadel.session",
        "net.host",
        "storage.user",
        "notifications",
        "clipboard.write",
    ];
    assert_eq!(caps, want);
    assert!(m.get("opens").is_none());
}
