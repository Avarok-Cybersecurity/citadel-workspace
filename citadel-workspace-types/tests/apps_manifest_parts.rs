//! A manifest's capabilities, each refusal beside the valid fixture it changes one thing of.
//! Limits, artifact and previous versions are `apps_manifest_artifact`.

mod apps_fixture;

use apps_fixture::{with, with_cap};
use citadel_workspace_types::apps_manifest::ManifestRefusal as R;
use citadel_workspace_types::apps_manifest_check_parts::is_route_pattern;
use serde_json::json;

fn caps_refused(result: Result<impl std::fmt::Debug, R>) -> bool {
    matches!(result, Err(R::Capabilities(_)))
}

#[test]
fn the_capability_list() {
    assert!(caps_refused(with(|m| m["capabilities"] = json!([]))));
    let twice = json!({ "cap": "canvas", "why": "Again", "optional": false });
    assert!(caps_refused(with_cap(1, twice)), "a capability named twice");
    assert!(caps_refused(with_cap(
        0,
        json!({ "cap": "canvas", "why": "", "optional": false })
    )));
    assert!(caps_refused(with_cap(
        0,
        json!({ "cap": "canvas", "why": "a\nb", "optional": false })
    )));
    assert!(matches!(
        with_cap(
            0,
            json!({ "cap": "roles.edit", "why": "x", "optional": false })
        ),
        Err(R::Json(_))
    ));
    assert!(
        matches!(
            with_cap(0, json!({ "cap": "canvas", "why": "x" })),
            Err(R::Json(_))
        ),
        "optional is required"
    );
    assert!(matches!(
        with_cap(
            0,
            json!({ "cap": "canvas", "why": "x", "optional": false, "scope": 1 })
        ),
        Err(R::Json(_))
    ));
}

#[test]
fn hosts_routes_and_targets_belong_only_to_their_capability() {
    // Each replaces the fixture's entry for the same capability, or one not otherwise listed,
    // so the only thing wrong is the field.
    for (index, entry) in [
        (
            1,
            json!({ "cap": "nodes.read", "why": "x", "optional": false, "hosts": ["a.io"] }),
        ),
        (
            1,
            json!({ "cap": "net.host", "why": "x", "optional": false }),
        ),
        (
            1,
            json!({ "cap": "net.host", "why": "x", "optional": false, "hosts": ["a.io"], "routes": ["GET /"] }),
        ),
        (
            3,
            json!({ "cap": "net.server", "why": "x", "optional": false, "hosts": ["a.io"], "targets": [] }),
        ),
        (
            4,
            json!({ "cap": "ihttp.serve", "why": "x", "optional": false }),
        ),
        (
            4,
            json!({ "cap": "ihttp.serve", "why": "x", "optional": false, "routes": ["GET /"], "hosts": ["a.io"] }),
        ),
        (
            5,
            json!({ "cap": "ihttp.call", "why": "x", "optional": false }),
        ),
        (
            5,
            json!({ "cap": "ihttp.call", "why": "x", "optional": false, "targets": [], "routes": ["GET /"] }),
        ),
    ] {
        assert!(caps_refused(with_cap(index, entry.clone())), "{entry}");
    }
    let host = json!({ "cap": "net.host", "why": "x", "optional": false, "hosts": ["a.io"] });
    assert!(
        with_cap(1, host).is_ok(),
        "control: net.host with its hosts"
    );
    let own_only = json!({ "cap": "ihttp.call", "why": "x", "optional": false, "targets": [] });
    assert!(
        with_cap(5, own_only).is_ok(),
        "control: calling only its own id"
    );
}

#[test]
fn hosts_are_explicit_and_at_most_eight() {
    let net = |hosts: serde_json::Value| json!({ "cap": "net.server", "why": "x", "optional": false, "hosts": hosts });
    for hosts in [
        json!(["*.acme.com"]),
        json!(["*"]),
        json!(["https://api.acme.com"]),
        json!(["api.acme.com/x"]),
        json!(["API.acme.com"]),
        json!([]),
        json!(["a.io", "a.io"]),
        json!((0..9).map(|i| format!("h{i}.acme.com")).collect::<Vec<_>>()),
    ] {
        assert!(caps_refused(with_cap(3, net(hosts.clone()))), "{hosts}");
    }
    let eight: Vec<String> = (0..8).map(|i| format!("h{i}.acme.com")).collect();
    assert!(with_cap(3, net(json!(eight))).is_ok());
}

#[test]
fn private_network_needs_host_network() {
    let private = json!({ "cap": "net.host.private", "why": "LAN API", "optional": false });
    assert!(
        caps_refused(with_cap(3, private.clone())),
        "net.host.private without net.host"
    );
    let host = json!({ "cap": "net.host", "why": "LAN API", "optional": false, "hosts": ["intranet.acme.com"] });
    assert!(with(|m| {
        m["capabilities"][3] = host;
        m["capabilities"].as_array_mut().unwrap().push(private);
    })
    .is_ok());
}

#[test]
fn routes_and_targets() {
    for route in [
        "GET /",
        "POST /cards",
        "GET /cards/:id",
        "GET /static/*",
        "DELETE /a.b/c~d/e-f",
    ] {
        assert!(is_route_pattern(route), "{route}");
    }
    for route in [
        "get /",
        "GET",
        "GET cards",
        "GET /a/../b",
        "GET /*/x",
        "GET /a//b",
        "GET /:",
        "GET /:Id",
        "TRACE /",
        "GET /a b",
        "GET /a?b",
    ] {
        assert!(!is_route_pattern(route), "{route}");
    }
    let serve = |routes: serde_json::Value| json!({ "cap": "ihttp.serve", "why": "x", "optional": false, "routes": routes });
    assert!(caps_refused(with_cap(
        4,
        serve(json!(["GET /a", "GET /a"]))
    )));
    assert!(caps_refused(with_cap(4, serve(json!([])))));
    assert!(caps_refused(with_cap(
        4,
        serve(json!((0..65)
            .map(|i| format!("GET /r{i}"))
            .collect::<Vec<_>>()))
    )));
    assert!(with_cap(
        4,
        serve(json!((0..64)
            .map(|i| format!("GET /r{i}"))
            .collect::<Vec<_>>()))
    )
    .is_ok());
    let call = |targets: serde_json::Value| json!({ "cap": "ihttp.call", "why": "x", "optional": false, "targets": targets });
    for targets in [
        json!(["com.acme.kanban"]),
        json!(["Not.an.id"]),
        json!(["com.a.b", "com.a.b"]),
    ] {
        assert!(
            caps_refused(with_cap(5, call(targets.clone()))),
            "{targets}"
        );
    }
}
