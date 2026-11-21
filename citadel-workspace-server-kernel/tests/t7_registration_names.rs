//! T7 under both `[identity] registration_names` (identity doc §6 rules 1-3, §7 rollout).
//! `require_canonical`: every new name is `handle@<canonical>`. `allow_legacy`, the shipped
//! setting until the UI's identity sign-up (I5): a bare name registers as it did before
//! identities, while a `handle@<canonical>` name keeps rule 2, rule 3 holds both ways (`alice`
//! and `alice@<any of the server's domains>` never both exist), and any other domain is refused
//! with the canonical refusal. The setting has no default: a server without it does not start.
//!
//! Real: `NamePolicy`, `config::plan`, `run_server_with_base_path` and the production server.
//! The account store is an in-memory [`AccountDirectory`]: the port is the store's lookup.

use citadel_sdk::prelude::ProtocolRemoteExt;
use citadel_workspace_server_kernel::config::ServerConfig;
use citadel_workspace_server_kernel::kernel::server_identity::config::{
    plan, IdentityConfig, IdentityPlan, RegistrationNames,
};
use citadel_workspace_server_kernel::kernel::server_identity::key_file::init_server_key;
use citadel_workspace_server_kernel::kernel::sign_in::name_policy::{AccountDirectory, NamePolicy};
use citadel_workspace_server_kernel::kernel::sign_in::{
    AdmissionContext, AdmissionKind, AdmissionPolicy, AdmissionRefusal,
};
use citadel_workspace_server_kernel::run_server_with_base_path;
use common::documents_test_utils::shipped_documents_section;
use common::production_server::{
    pinned_identity_toml, sign_in_dir, sign_in_without_admission,
    start_native_server_with_identity, test_path_policy_toml, test_stun_servers_toml,
    TEST_CANONICAL_DOMAIN,
};
use common::sign_in_client::{drive, username, PASSWORD, TEST_SERVER_CERTIFICATE};
use std::collections::HashSet;
use std::sync::Arc;

struct Accounts(HashSet<String>);

#[async_trait::async_trait]
impl AccountDirectory for Accounts {
    async fn exists(&self, username: &str) -> Result<bool, String> {
        Ok(self.0.contains(username))
    }
}

const SECTION: &str =
    "canonical_domain = \"acme.example\"\nformer_domains = [\"acme.work.avarok.net\"]\n\
     discovery = \"pinned\"\n";
const CANONICAL: &str = "citadel-identity-v1 canonical=acme.example";
const TAKEN: &str = "already taken";

fn acme(names: &str) -> IdentityPlan {
    let toml = format!("{SECTION}registration_names = \"{names}\"\n");
    plan(Some(&toml::from_str(&toml).unwrap())).expect("plan")
}

async fn register(plan: IdentityPlan, taken: &[&str], username: &str) -> Result<(), String> {
    let accounts = Arc::new(Accounts(taken.iter().map(|s| s.to_string()).collect()));
    let ctx = AdmissionContext {
        username: username.to_string(),
        kind: AdmissionKind::Register,
        token: None,
        remote_addr: None,
    };
    NamePolicy::new(plan, accounts, None)
        .admit(ctx)
        .await
        .map_err(|refusal| match refusal {
            AdmissionRefusal::Failed(reason) => reason,
            other => panic!("{username}: not a reasoned refusal: {other:?}"),
        })
}

fn outcome(result: &Result<(), String>, expected: Option<&str>) -> bool {
    match (result, expected) {
        (Ok(()), None) => true,
        (Err(reason), Some(want)) => reason.contains(want),
        _ => false,
    }
}

/// T7's table, one row per name: `None` is admitted, `Some(reason)` refused with it. `alice` is
/// already an account.
#[tokio::test]
async fn t7_s_table_under_both_settings() {
    let rows: [(&str, Option<&str>, Option<&str>); 9] = [
        // (name, require_canonical, allow_legacy)
        ("bob", Some(CANONICAL), None),
        ("Bob_Legacy-1", Some(CANONICAL), None),
        ("bob@other.example", Some(CANONICAL), Some(CANONICAL)),
        ("bob@acme.work.avarok.net", Some(CANONICAL), Some(CANONICAL)),
        ("a@b@acme.example", Some("@"), Some("@")),
        (
            "bob smith@acme.example",
            Some("the username is refused"),
            Some("the username is refused"),
        ),
        (
            "bo..b@acme.example",
            Some("the username is refused"),
            Some("the username is refused"),
        ),
        ("alice@acme.example", Some(TAKEN), Some(TAKEN)),
        ("john.doe@acme.example", None, None),
    ];
    for (name, require, allow) in rows {
        for (names, expected) in [("require_canonical", require), ("allow_legacy", allow)] {
            let result = register(acme(names), &["alice"], name).await;
            assert!(
                outcome(&result, expected),
                "{names} {name}: {result:?}, want {expected:?}"
            );
        }
    }
}

#[tokio::test]
async fn allow_legacy_a_bare_name_registers() {
    register(acme("allow_legacy"), &[], "alice")
        .await
        .expect("a bare name registers under allow_legacy");
}

#[tokio::test]
async fn allow_legacy_a_bare_name_reserves_its_handle() {
    let refused = register(acme("allow_legacy"), &["alice"], "alice@acme.example")
        .await
        .unwrap_err();
    assert!(refused.contains(TAKEN), "{refused}");
}

#[tokio::test]
async fn allow_legacy_a_domain_name_reserves_its_bare_handle() {
    for taken in ["alice@acme.example", "alice@acme.work.avarok.net"] {
        let refused = register(acme("allow_legacy"), &[taken], "alice")
            .await
            .unwrap_err();
        assert!(refused.contains(TAKEN), "after {taken}: {refused}");
    }
}

#[tokio::test]
async fn allow_legacy_a_foreign_domain_is_refused_with_the_canonical_refusal() {
    let refused = register(acme("allow_legacy"), &[], "bob@other.example")
        .await
        .unwrap_err();
    assert_eq!(refused, CANONICAL);
}

#[test]
fn the_setting_is_required_and_has_exactly_two_values() {
    let missing = plan(Some(&toml::from_str(SECTION).unwrap())).unwrap_err();
    assert!(
        missing.contains("registration_names is required"),
        "{missing}"
    );
    let other = format!("{SECTION}registration_names = \"open\"\n");
    assert!(toml::from_str::<IdentityConfig>(&other).is_err());
    assert_eq!(
        acme("allow_legacy").registration_names,
        RegistrationNames::AllowLegacy
    );
    assert_eq!(
        acme("require_canonical").registration_names,
        RegistrationNames::RequireCanonical
    );
}

#[test]
fn the_shipped_kernel_toml_allows_legacy_names_until_i5() {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../docker/workspace-server/kernel.toml");
    let config: ServerConfig =
        toml::from_str(&std::fs::read_to_string(path).expect("read")).expect("parses");
    let mut identity = config.identity.expect("[identity]");
    identity.server_key_file = None;
    assert_eq!(
        plan(Some(&identity)).expect("plan").registration_names,
        RegistrationNames::AllowLegacy
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_server_without_the_setting_refuses_to_start() {
    let dir = sign_in_dir();
    let key = dir.join("server-key");
    init_server_key(&key).expect("server key");
    // Every other required key present, so the refusal can only be the missing setting.
    let identity = format!(
        "[identity]\ncanonical_domain = \"{TEST_CANONICAL_DOMAIN}\"\nformer_domains = []\n\
         discovery = \"pinned\"\nserver_key_file = \"{}\"\n",
        key.display()
    );
    let config: ServerConfig = toml::from_str(&format!(
        "bind_addr = \"127.0.0.1:0\"\nworkspace_master_password = \"a-test-master-password\"\n\
         require_platform_terms = false\nsecure_links_per_member = 5\nsecure_links_pool = 0\n\
         chat_documents_limit = 0\nchat_attachment_max_bytes = 0\n\
         chat_attachment_max_files_per_node = 0\n{}\n{}\n{}\n{}\n{identity}",
        test_stun_servers_toml(),
        sign_in_without_admission(&dir),
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
        refused.expect_err("a server without registration_names started")
    );
    assert!(error.contains("registration_names is required"), "{error}");
}

#[tokio::test(flavor = "multi_thread")]
async fn an_allow_legacy_production_server_registers_a_bare_name_and_reserves_its_handle() {
    citadel_logging::setup_log();
    let identity = pinned_identity_toml(&sign_in_dir(), TEST_CANONICAL_DOMAIN, "allow_legacy");
    let addr = start_native_server_with_identity(&identity).await;
    let bare = username("carol").replace(&format!("@{TEST_CANONICAL_DOMAIN}"), "");
    drive(move |remote| async move {
        remote
            .register_with_defaults(
                addr,
                "Carol Clark",
                bare.as_str(),
                PASSWORD,
                TEST_SERVER_CERTIFICATE,
            )
            .await?;
        let named = format!("{bare}@{TEST_CANONICAL_DOMAIN}");
        let refused = remote
            .register_with_defaults(
                addr,
                "Carol Clark",
                named.as_str(),
                PASSWORD,
                TEST_SERVER_CERTIFICATE,
            )
            .await
            .map(|_| ())
            .expect_err("a handle registered beside its bare name");
        assert!(format!("{refused:?}").contains(TAKEN), "{refused:?}");
        Ok(())
    })
    .await
    .expect("the client ran");
}
