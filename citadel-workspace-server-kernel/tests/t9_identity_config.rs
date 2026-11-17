//! T9 (identity doc §10 rev b, master plan §9 D-A): a server will not start without
//! `[identity] { canonical_domain, former_domains, discovery }`, and nothing stands in for a
//! missing key -- least of all `bind_addr`, which is where a socket listens, not the name people
//! reach it by. `GetWorkspace.accepted_domains` is `[canonical, former…]`, and the
//! `/.well-known/citadel` the kernel builds is the contract's known answer and fits its frozen
//! schema.
//!
//! Real: `run_server_with_base_path`, `config::plan`, the command processor and
//! `ServerIdentity::well_known_document`, against the contract's fixtures.

use citadel_identity::{canonical_domain, parse_well_known};
use citadel_workspace_server_kernel::config::ServerConfig;
use citadel_workspace_server_kernel::kernel::server_identity::config::{plan, IdentityConfig};
use citadel_workspace_server_kernel::kernel::server_identity::hosted_identity;
use citadel_workspace_server_kernel::run_server_with_base_path;
use citadel_workspace_types::{WorkspaceProtocolRequest, WorkspaceProtocolResponse};
use common::async_test_helpers::execute_command;
use common::documents_test_utils::shipped_documents_section;
use common::identity_kat::{identity_config_of, read_json, seed, server};
use common::production_server::{
    sign_in_dir, sign_in_without_admission, test_path_policy_toml, test_stun_servers_toml,
};
use common::workspace_test_utils::create_configured_test_kernel;
use serde_json::Value;
use std::sync::Arc;

fn section(toml: &str) -> IdentityConfig {
    toml::from_str(toml).expect("parses")
}

fn refusal(toml: &str) -> String {
    plan(Some(&section(toml))).expect_err(&format!("accepted {toml}"))
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn startup_fails_without_identity() {
    // Every other required key present, so the refusal can only be the missing section.
    let config: ServerConfig = toml::from_str(&format!(
        "bind_addr = \"127.0.0.1:0\"\nworkspace_master_password = \"a-test-master-password\"\n\
         require_platform_terms = false\nsecure_links_per_member = 5\nsecure_links_pool = 0\n\
         chat_documents_limit = 0\nchat_attachment_max_bytes = 0\n\
         chat_attachment_max_files_per_node = 0\n{}\n{}\n{}\n{}",
        test_stun_servers_toml(),
        sign_in_without_admission(&sign_in_dir()),
        shipped_documents_section(),
        test_path_policy_toml()
    ))
    .expect("config");
    let refused = tokio::time::timeout(
        std::time::Duration::from_secs(30),
        run_server_with_base_path(config, None),
    )
    .await
    .expect("refuses at once rather than serving");
    let error = format!(
        "{:?}",
        refused.expect_err("a server without [identity] started")
    );
    assert!(error.contains("no [identity] section"), "{error}");
}

#[test]
fn every_key_is_required_and_none_has_a_default() {
    assert!(plan(None).unwrap_err().contains("no [identity] section"));
    let unnamed = refusal("former_domains = []\ndiscovery = \"pinned\"\n");
    assert!(
        unnamed.contains("canonical_domain is required"),
        "{unnamed}"
    );
    let undiscovered = refusal("canonical_domain = \"acme.example\"\nformer_domains = []\n");
    assert!(
        undiscovered.contains("discovery is required"),
        "{undiscovered}"
    );
    let no_former = refusal("canonical_domain = \"acme.example\"\ndiscovery = \"pinned\"\n");
    assert!(
        no_former.contains("former_domains is required"),
        "{no_former}"
    );
}

#[test]
fn a_bad_section_is_refused_by_name() {
    let base = "former_domains = []\ndiscovery = \"pinned\"\n";
    let upper = refusal(&format!("canonical_domain = \"Acme.Example\"\n{base}"));
    assert!(
        upper.contains("not canonical") && upper.contains("acme.example"),
        "{upper}"
    );
    let scheme = refusal(&format!(
        "canonical_domain = \"https://acme.example\"\n{base}"
    ));
    assert!(scheme.contains("not canonical"), "{scheme}");
    let repeated = refusal(
        "canonical_domain = \"acme.example\"\nformer_domains = [\"acme.example\"]\n\
         discovery = \"pinned\"\n",
    );
    assert!(repeated.contains("repeats"), "{repeated}");
    let stray = refusal(&format!(
        "canonical_domain = \"acme.example\"\n{base}citadel_wss = \"wss://acme.example/c\"\n"
    ));
    assert!(stray.contains("nothing publishes it"), "{stray}");
    let unpublished = refusal(
        "canonical_domain = \"acme.example\"\nformer_domains = []\ndiscovery = \"well_known\"\n",
    );
    assert!(
        unpublished.contains("citadel_wss is required"),
        "{unpublished}"
    );
    let third = toml::from_str::<IdentityConfig>(
        "canonical_domain = \"acme.example\"\nformer_domains = []\ndiscovery = \"open\"\n",
    );
    assert!(
        third.is_err(),
        "a discovery mode other than well_known or pinned parsed"
    );
}

fn repo(path: &str) -> String {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join(path);
    std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{path:?}: {e}"))
}

#[test]
fn the_shipped_section_is_accepted_and_its_key_is_made_by_the_start_script() {
    let config: ServerConfig =
        toml::from_str(&repo("docker/workspace-server/kernel.toml")).expect("parses");
    let identity = config
        .identity
        .expect("the shipped kernel.toml has [identity]");
    plan(Some(&identity)).expect("the shipped [identity] is refused");
    let key = identity.server_key_file.expect("server_key_file");
    let script = repo("docker/workspace-server/start.sh");
    assert!(
        script.contains(&format!("SERVER_KEY={key}\n")),
        "start.sh does not make {key}"
    );
    assert!(script.contains("--init-server-key \"$SERVER_KEY\""));
}

#[tokio::test]
async fn get_workspace_lists_the_canonical_domain_first_then_the_former_ones() {
    let document = read_json("fixtures/well-known-citadel/valid-custom-domain.json");
    let identity = hosted_identity(
        Some(&identity_config_of(&document)),
        &seed(&server("acme.example"), "/key/seed_hex"),
    )
    .expect("identity");
    let installed = Arc::new(identity);
    let kernel =
        create_configured_test_kernel(move |k| k.set_server_identity(Some(installed))).await;
    let answer = execute_command(
        &kernel,
        WorkspaceProtocolRequest::GetWorkspace { workspace_id: None },
    )
    .await
    .expect("answered");
    let WorkspaceProtocolResponse::Workspace(workspace) = answer else {
        panic!("not a workspace: {answer:?}");
    };
    assert_eq!(
        workspace.accepted_domains,
        ["acme.example", "acme.work.avarok.net"]
    );
}

/// Every key the schema allows at `pointer`, and that `document` has exactly those it requires.
fn assert_shape(schema: &Value, document: &Value) {
    let allowed: Vec<&String> = schema["properties"].as_object().unwrap().keys().collect();
    let required: Vec<&str> = schema["required"]
        .as_array()
        .unwrap()
        .iter()
        .map(|k| k.as_str().unwrap())
        .collect();
    let present: Vec<&String> = document.as_object().unwrap().keys().collect();
    assert_eq!(schema["additionalProperties"], Value::Bool(false));
    for key in &present {
        assert!(allowed.contains(key), "{key} is not in the schema");
    }
    for key in required {
        assert!(document.get(key).is_some(), "{key} is required");
    }
    for (key, rule) in schema["properties"].as_object().unwrap() {
        let Some(value) = document.get(key) else {
            continue;
        };
        if rule["type"] == "object" {
            assert_shape(rule, value);
        }
        if let Some(fixed) = rule.get("const") {
            assert_eq!(value, fixed, "{key}");
        }
        if let (Some(text), Some(min), Some(max)) = (
            value.as_str(),
            rule["minLength"].as_u64(),
            rule["maxLength"].as_u64(),
        ) {
            assert!(
                (min..=max).contains(&(text.len() as u64)),
                "{key} length {}",
                text.len()
            );
        }
        if let (Some(n), Some(min), Some(max)) = (
            value.as_u64(),
            rule["minimum"].as_u64(),
            rule["maximum"].as_u64(),
        ) {
            assert!((min..=max).contains(&n), "{key} = {n}");
        }
    }
}

#[test]
fn the_built_document_is_the_contract_fixture_and_fits_the_schema() {
    let schema = read_json("well-known-citadel.schema.json");
    for (name, fixture) in [
        ("main.work.avarok.net", "valid-hosted-tenant.json"),
        ("acme.example", "valid-custom-domain.json"),
    ] {
        let expected = read_json(&format!("fixtures/well-known-citadel/{fixture}"));
        let identity = hosted_identity(
            Some(&identity_config_of(&expected)),
            &seed(&server(name), "/key/seed_hex"),
        )
        .expect("identity");
        let issued_at = expected["issued_at"].as_u64().unwrap();
        let built = identity.well_known_document(issued_at).expect("document");
        let document: Value = serde_json::from_slice(&built).expect("JSON");
        assert_eq!(
            document, expected,
            "{name}: the built document is not the fixture"
        );
        assert_shape(&schema, &document);
        parse_well_known(&built, &canonical_domain(name).unwrap()).expect("the agent accepts it");
    }
}

#[test]
fn a_pinned_server_publishes_no_document() {
    let config = section(
        "canonical_domain = \"acme.example\"\nformer_domains = []\ndiscovery = \"pinned\"\n\
         registration_names = \"allow_legacy\"\n",
    );
    let identity = hosted_identity(Some(&config), &[1; 32]).expect("identity");
    assert!(identity.well_known_document(1_794_700_000).is_err());
}
