//! `citadel.session`'s `servers` and `limits.session`, and the `node_page` surface
//! (citadel-session-abi §2, node-page-abi §1), each beside the valid fixture it changes.

mod apps_fixture;

use apps_fixture::with;
use citadel_app_sdk_types::calls::session::{
    MAX_SESSION_SERVERS, SESSION_MAX_MSGS_PER_S_CEILING, SESSION_MAX_MSG_BYTES_CEILING,
};
use citadel_workspace_types::apps_manifest::{AppSurface, ManifestRefusal as R, SessionLimits};
use citadel_workspace_types::apps_manifest_session::is_canonical_server;
use serde_json::{json, Value};

fn session(servers: Value, limits: Option<Value>) -> Result<(), R> {
    with(|m| {
        m["capabilities"][5] = json!({ "cap": "citadel.session", "why": "Keeps the graph live", "optional": false, "servers": servers });
        if let Some(limits) = limits {
            m["limits"]["session"] = limits;
        }
    })
    .map(|_| ())
}

fn limits(bytes: u32, rate: u32) -> Option<Value> {
    Some(json!({ "max_msg_bytes": bytes, "max_msgs_per_s": rate }))
}

#[test]
fn a_session_to_named_servers_is_read_with_its_limits() {
    let manifest = with(|m| {
        m["capabilities"][5] = json!({ "cap": "citadel.session", "why": "x", "optional": false, "servers": ["synchronized.work"] });
        m["limits"]["session"] = json!({ "max_msg_bytes": 65536, "max_msgs_per_s": 16 });
    })
    .expect("accepted");
    assert_eq!(
        manifest.capabilities[5].servers.as_deref(),
        Some(&["synchronized.work".to_string()][..])
    );
    let expected = SessionLimits {
        max_msg_bytes: 65536,
        max_msgs_per_s: 16,
    };
    assert_eq!(manifest.limits.session, Some(expected));
}

#[test]
fn servers_are_one_or_two_distinct_canonical_domains() {
    let ok = limits(1024, 8);
    assert_eq!(
        session(json!(["a.example", "b.example:8443"]), ok.clone()),
        Ok(())
    );
    assert_eq!(
        session(json!(["shared.example/tenant-a"]), ok.clone()),
        Ok(())
    );
    let too_many: Vec<String> = (0..=MAX_SESSION_SERVERS)
        .map(|i| format!("s{i}.example"))
        .collect();
    for servers in [
        json!([]),
        json!(too_many),
        json!(["a.example", "a.example"]),
        json!(["https://a.example"]),
        json!(["A.example"]),
        json!(["a.example:443"]),
        json!(["a.example/"]),
        json!(["alice@a.example"]),
    ] {
        assert!(
            matches!(
                session(servers.clone(), ok.clone()),
                Err(R::Capabilities(_))
            ),
            "{servers}"
        );
    }
}

#[test]
fn servers_belong_to_citadel_session_only() {
    let refused = with(|m| m["capabilities"][0]["servers"] = json!(["a.example"]));
    assert!(
        matches!(refused, Err(R::Capabilities(_))),
        "servers on canvas"
    );
    let missing = with(|m| {
        m["capabilities"][5] = json!({ "cap": "citadel.session", "why": "x", "optional": false });
        m["limits"]["session"] = json!({ "max_msg_bytes": 1, "max_msgs_per_s": 1 });
    });
    assert!(
        matches!(missing, Err(R::Capabilities(_))),
        "citadel.session without servers"
    );
}

#[test]
fn limits_session_is_present_exactly_with_the_capability_and_within_the_sdk_ceilings() {
    let servers = json!(["synchronized.work"]);
    assert!(matches!(session(servers.clone(), None), Err(R::Limits(f)) if f == "session"));
    let stray =
        with(|m| m["limits"]["session"] = json!({ "max_msg_bytes": 1, "max_msgs_per_s": 1 }));
    assert!(matches!(stray, Err(R::Limits(f)) if f == "session"));
    let (bytes, rate) = (
        SESSION_MAX_MSG_BYTES_CEILING,
        SESSION_MAX_MSGS_PER_S_CEILING,
    );
    assert_eq!(session(servers.clone(), limits(bytes, rate)), Ok(()));
    for (b, r) in [(0, 1), (bytes + 1, 1), (1, 0), (1, rate + 1)] {
        assert!(
            matches!(session(servers.clone(), limits(b, r)), Err(R::Limits(_))),
            "{b} {r}"
        );
    }
}

#[test]
fn a_canonical_server_is_what_canonical_domain_leaves_unchanged() {
    assert!(is_canonical_server("synchronized.work"));
    assert!(is_canonical_server("[::1]:8443"));
    assert!(!is_canonical_server("[0:0::1]:8443"));
    assert!(!is_canonical_server("wss://synchronized.work"));
    assert!(!is_canonical_server(""));
}

#[test]
fn a_node_page_needs_a_scope_that_reaches_a_node() {
    let page = with(|m| m["surfaces"] = json!(["node_page"])).expect("accepted");
    assert_eq!(page.surfaces, [AppSurface::NodePage]);
    for scopes in [json!(["self"]), json!(["users", "self"])] {
        let refused = with(|m| {
            m["surfaces"] = json!(["node_page"]);
            m["scopes"] = scopes.clone();
        });
        assert!(matches!(refused, Err(R::Scopes)), "{scopes}");
    }
    let at_a_node = with(|m| {
        m["surfaces"] = json!(["node_page", "node_tab"]);
        m["scopes"] = json!(["node", "self"]);
    });
    assert!(at_a_node.is_ok());
    assert!(matches!(
        with(|m| m["surfaces"] = json!(["node_page", "node_page"])),
        Err(R::Surfaces)
    ));
}
