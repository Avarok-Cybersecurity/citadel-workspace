//! A manifest is refused for each malformed field, and each refusal sits beside the valid
//! manifest it was made from (`the_fixture_is_valid`), so it is the field that refused it.

mod apps_fixture;

use apps_fixture::{png, valid, with};
use citadel_workspace_types::apps_manifest::{
    AppManifest, ManifestRefusal as R, MAX_MANIFEST_BYTES,
};
use serde_json::json;

#[test]
fn the_fixture_is_valid_and_round_trips() {
    let manifest = with(|_| {}).expect("the control manifest is valid");
    assert_eq!(manifest.id, "com.acme.kanban");
    let again: AppManifest =
        serde_json::from_value(serde_json::to_value(&manifest).unwrap()).unwrap();
    assert_eq!(again, manifest);
    // `previous_versions` is the one optional field.
    assert!(with(|m| drop(m.as_object_mut().unwrap().remove("previous_versions"))).is_ok());
    // A background app paints nowhere.
    assert!(with(|m| m["surfaces"] = json!([])).is_ok());
}

#[test]
fn unknown_duplicate_and_missing_fields_are_refused() {
    assert!(matches!(with(|m| m["extra"] = json!(1)), Err(R::Json(_))));
    assert!(matches!(
        with(|m| m["sdk"]["extra"] = json!(1)),
        Err(R::Json(_))
    ));
    assert!(matches!(
        with(|m| drop(m.as_object_mut().unwrap().remove("limits"))),
        Err(R::Json(_))
    ));
    let text = serde_json::to_string(&valid()).unwrap().replacen(
        "\"format\":1,",
        "\"format\":1,\"format\":1,",
        1,
    );
    assert!(
        text.contains("\"format\":1,\"format\":1,"),
        "the duplicate was written"
    );
    assert!(matches!(
        AppManifest::from_bytes(text.as_bytes()),
        Err(R::Json(_))
    ));
    assert!(matches!(AppManifest::from_bytes(b"[]"), Err(R::Json(_))));
    let big = vec![b' '; MAX_MANIFEST_BYTES + 1];
    assert_eq!(AppManifest::from_bytes(&big), Err(R::TooLarge));
}

#[test]
fn format_id_and_version() {
    assert_eq!(with(|m| m["format"] = json!(2)).unwrap_err(), R::Format);
    for id in ["Kanban", "kanban", "com..acme", "com.acme_kanban"] {
        assert_eq!(with(|m| m["id"] = json!(id)).unwrap_err(), R::Id, "{id}");
    }
    for version in ["1.4", "01.4.0", "1.4.0-beta", "v1.4.0"] {
        assert_eq!(
            with(|m| m["version"] = json!(version)).unwrap_err(),
            R::Version,
            "{version}"
        );
    }
}

#[test]
fn sdk() {
    assert!(matches!(
        with(|m| m["sdk"]["abi"] = json!("wasi-preview2")),
        Err(R::Sdk(_))
    ));
    assert!(matches!(
        with(|m| m["sdk"]["min"] = json!("1.0")),
        Err(R::Sdk(_))
    ));
    assert!(matches!(
        with(|m| m["sdk"]["max"] = json!("0.x")),
        Err(R::Sdk(_))
    ));
    assert!(matches!(
        with(|m| m["sdk"]["max"] = json!("0.9.0")),
        Err(R::Sdk(_))
    ));
    assert!(matches!(
        with(|m| m["sdk"]["max"] = json!("x")),
        Err(R::Sdk(_))
    ));
    assert!(
        with(|m| m["sdk"]["max"] = json!("1.2.0")).is_ok(),
        "control: a version ceiling"
    );
    assert!(with(|m| m["sdk"]["abi"] = json!("wasm-bindgen-glue-firstparty")).is_ok());
}

#[test]
fn publisher() {
    for key in [
        "ab".repeat(1951) + "a",
        "AB".repeat(1952),
        "zz".repeat(1952),
    ] {
        assert!(matches!(
            with(|m| m["publisher"]["mldsa65_public_key"] = json!(key)),
            Err(R::Publisher(_))
        ));
    }
    for contact in [
        "http://acme.example",
        "https://u@acme.example/",
        "mailto:a@acme.example",
        "",
    ] {
        assert!(
            matches!(
                with(|m| m["publisher"]["contact"] = json!(contact)),
                Err(R::Publisher(_))
            ),
            "{contact}"
        );
    }
    assert!(matches!(
        with(|m| m["publisher"]["name"] = json!("")),
        Err(R::Publisher(_))
    ));
}

#[test]
fn name_summary_and_description_are_plain_text() {
    for name in ["", " Kanban", "Kan\u{0}ban", "Kan\nban", &"n".repeat(49)] {
        assert_eq!(
            with(|m| m["name"] = json!(name)).unwrap_err(),
            R::Name,
            "{name:?}"
        );
    }
    assert!(with(|m| m["name"] = json!("n".repeat(48))).is_ok());
    for summary in ["", "two\nlines", &"s".repeat(141)] {
        assert_eq!(
            with(|m| m["summary"] = json!(summary)).unwrap_err(),
            R::Summary
        );
    }
    for description in ["tab\there", "crlf\r\nhere", "", &"d".repeat(4001)] {
        assert_eq!(
            with(|m| m["description"] = json!(description)).unwrap_err(),
            R::Description
        );
    }
}

#[test]
fn the_icon_is_a_png_within_its_cap() {
    let not_png = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, b"GIF89a....");
    for (icon, max) in [
        (not_png, 65536),
        ("not base64!".to_string(), 65536),
        (png(65537), 65536),
        (png(200), 100),
        (png(64), 0),
        (png(64), 65537),
        (png(64).trim_end_matches('=').to_string(), 65536),
    ] {
        let refused = with(|m| m["icon"] = json!({ "png_base64": icon, "max_bytes": max }));
        assert!(matches!(refused, Err(R::Icon(_))), "{max}");
    }
    assert!(with(|m| m["icon"] = json!({ "png_base64": png(65536), "max_bytes": 65536 })).is_ok());
}

#[test]
fn categories_surfaces_and_scopes() {
    for categories in [
        json!([]),
        json!(["planning", "planning"]),
        json!(["planning", "design", "data", "files"]),
    ] {
        assert_eq!(
            with(|m| m["categories"] = categories).unwrap_err(),
            R::Categories
        );
    }
    assert!(matches!(
        with(|m| m["categories"] = json!(["games"])),
        Err(R::Json(_))
    ));
    assert_eq!(
        with(|m| m["surfaces"] = json!(["md_zone", "md_zone"])).unwrap_err(),
        R::Surfaces
    );
    assert!(matches!(
        with(|m| m["surfaces"] = json!(["page_dom"])),
        Err(R::Json(_))
    ));
    assert_eq!(with(|m| m["scopes"] = json!([])).unwrap_err(), R::Scopes);
    assert_eq!(
        with(|m| m["scopes"] = json!(["self", "self"])).unwrap_err(),
        R::Scopes
    );
    assert!(with(|m| m["scopes"] = json!(["self"])).is_ok());
}

#[test]
fn the_audience() {
    for audience in [
        json!({ "kind": "members", "usernames": [] }),
        json!({ "kind": "members", "usernames": ["alice", "alice"] }),
        json!({ "kind": "roles", "role_ids": [""] }),
        json!({ "kind": "node_viewers", "node_id": "a/b" }),
        json!({ "kind": "node_tree_viewers", "node_id": "" }),
    ] {
        assert!(
            matches!(
                with(|m| m["audience"] = audience.clone()),
                Err(R::Audience(_))
            ),
            "{audience}"
        );
    }
    for audience in [
        json!({ "kind": "everyone" }),
        json!({ "kind": "workspace", "node_id": "x" }),
    ] {
        assert!(matches!(
            with(|m| m["audience"] = audience),
            Err(R::Json(_))
        ));
    }
    for audience in [
        json!({ "kind": "workspace" }),
        json!({ "kind": "members", "usernames": ["alice", "bob"] }),
        json!({ "kind": "roles", "role_ids": ["member"] }),
        json!({ "kind": "node_tree_viewers", "node_id": "office-1" }),
    ] {
        assert!(with(|m| m["audience"] = audience).is_ok());
    }
}
