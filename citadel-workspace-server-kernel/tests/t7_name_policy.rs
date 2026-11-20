//! T7 (identity doc §6/§10 rev b), under `registration_names = "require_canonical"` (the
//! `allow_legacy` table is `t7_name_policy_allow_legacy.rs`): every registration on a server is
//! `handle@<canonical>`.
//! A bare name, another domain, a former domain, an `@` or a space in the handle, `..`, a
//! 256-byte name and a handle someone already holds (as `alice`, or under any of the server's
//! domains) are each refused with their reason; a dotted handle and a 255-byte name are admitted.
//! The same with the server's own check (Turnstile) off and on, which never sees a refused name.
//! Sign-ins are not this policy's: a legacy account keeps signing in. The server's credential
//! rules admit 255 bytes and refuse 256.
//!
//! Real: `NamePolicy`, `production_server_misc_settings`, and the production server. The account
//! store is an in-memory [`AccountDirectory`]: the port is the store's lookup and nothing else.

use citadel_sdk::prelude::ProtocolRemoteExt;
use citadel_workspace_server_kernel::kernel::server_identity::config::{plan, IdentityPlan};
use citadel_workspace_server_kernel::kernel::sign_in::name_policy::{AccountDirectory, NamePolicy};
use citadel_workspace_server_kernel::kernel::sign_in::{
    AdmissionContext, AdmissionKind, AdmissionPolicy, AdmissionRefusal,
};
use common::production_server::{start_production_server, TEST_CANONICAL_DOMAIN};
use common::sign_in_client::{drive, username, PASSWORD, TEST_SERVER_CERTIFICATE};
use parking_lot::Mutex;
use std::collections::HashSet;
use std::sync::Arc;
use std::time::Duration;

struct Accounts(HashSet<String>);

#[async_trait::async_trait]
impl AccountDirectory for Accounts {
    async fn exists(&self, username: &str) -> Result<bool, String> {
        Ok(self.0.contains(username))
    }
}

/// Stands for the server's own check: admits, and records whom it was asked about.
#[derive(Default)]
struct Turnstile(Mutex<Vec<String>>);

#[async_trait::async_trait]
impl AdmissionPolicy for Turnstile {
    async fn admit(&self, ctx: AdmissionContext) -> Result<(), AdmissionRefusal> {
        self.0.lock().push(ctx.username);
        Ok(())
    }

    fn resume_grace(&self) -> Duration {
        Duration::from_secs(900)
    }
}

fn identity(canonical: &str, former: &[&str]) -> IdentityPlan {
    let former: Vec<String> = former.iter().map(|f| format!("{f:?}")).collect();
    let toml = format!(
        "canonical_domain = {canonical:?}\nformer_domains = [{}]\ndiscovery = \"pinned\"\n\
         registration_names = \"require_canonical\"\n",
        former.join(", ")
    );
    plan(Some(&toml::from_str(&toml).unwrap())).expect("plan")
}

fn acme() -> IdentityPlan {
    identity("acme.example", &["acme.work.avarok.net"])
}

fn ctx(username: &str, kind: AdmissionKind) -> AdmissionContext {
    AdmissionContext {
        username: username.to_string(),
        kind,
        token: None,
        remote_addr: None,
    }
}

async fn register(policy: &NamePolicy, username: &str) -> Result<(), String> {
    policy
        .admit(ctx(username, AdmissionKind::Register))
        .await
        .map_err(|refusal| match refusal {
            AdmissionRefusal::Failed(reason) => reason,
            other => panic!("{username}: not a reasoned refusal: {other:?}"),
        })
}

fn policies(plan: IdentityPlan, taken: &[&str]) -> Vec<(NamePolicy, Option<Arc<Turnstile>>)> {
    let accounts = || Arc::new(Accounts(taken.iter().map(|s| s.to_string()).collect()));
    let turnstile = Arc::new(Turnstile::default());
    vec![
        (NamePolicy::new(plan.clone(), accounts(), None), None),
        (
            NamePolicy::new(plan, accounts(), Some(turnstile.clone())),
            Some(turnstile),
        ),
    ]
}

const CANONICAL: &str = "citadel-identity-v1 canonical=acme.example";

#[tokio::test]
async fn each_refused_name_is_refused_with_its_reason_check_on_or_off() {
    let cases: [(&str, &str); 7] = [
        ("bob", CANONICAL),
        ("bob@other.example", CANONICAL),
        ("bob@acme.work.avarok.net", CANONICAL),
        ("a@b@acme.example", "@"),
        ("bob smith@acme.example", "the username is refused"),
        ("bo..b@acme.example", "the username is refused"),
        ("alice@acme.example", "already taken"),
    ];
    for (policy, turnstile) in policies(acme(), &["alice"]) {
        for (name, reason) in cases {
            let refused = register(&policy, name).await.expect_err(name);
            assert!(refused.contains(reason), "{name}: {refused}");
        }
        if let Some(turnstile) = turnstile {
            assert!(
                turnstile.0.lock().is_empty(),
                "the check was asked about a refused name"
            );
        }
    }
}

#[tokio::test]
async fn a_handle_held_under_a_former_domain_is_reserved() {
    for (policy, _) in policies(acme(), &["carol@acme.work.avarok.net"]) {
        let refused = register(&policy, "carol@acme.example").await.unwrap_err();
        assert!(refused.contains("already taken"), "{refused}");
        register(&policy, "dave@acme.example")
            .await
            .expect("a free handle");
    }
}

#[tokio::test]
async fn a_dotted_handle_and_a_255_byte_name_are_admitted() {
    for (policy, turnstile) in policies(acme(), &["alice"]) {
        register(&policy, "john.doe@acme.example")
            .await
            .expect("dotted");
        if let Some(turnstile) = turnstile {
            assert_eq!(
                *turnstile.0.lock(),
                ["john.doe@acme.example"],
                "the check was skipped"
            );
        }
    }
    // 63 + 1 + 63 + 1 + 62 = 190 bytes, the longest canonical domain; 64 + 1 + 190 = 255.
    let domain = format!("{}.{}.{}", "a".repeat(63), "b".repeat(63), "c".repeat(62));
    let longest = format!("{}@{domain}", "h".repeat(64));
    assert_eq!(longest.len(), citadel_identity::MAX_USERNAME_BYTES);
    for (policy, _) in policies(identity(&domain, &[]), &[]) {
        register(&policy, &longest).await.expect("255 bytes");
        let over = register(&policy, &format!("{longest}x")).await.unwrap_err();
        assert!(over.contains("the username is refused"), "{over}");
    }
}

#[tokio::test]
async fn a_legacy_account_still_signs_in() {
    for (policy, turnstile) in policies(acme(), &["john.doe"]) {
        policy
            .admit(ctx("john.doe", AdmissionKind::SignIn))
            .await
            .expect("a bare name signs in");
        if let Some(turnstile) = turnstile {
            assert_eq!(
                *turnstile.0.lock(),
                ["john.doe"],
                "the sign-in skipped the check"
            );
        }
    }
}

#[test]
fn the_server_s_credential_rules_admit_255_bytes_and_refuse_256() {
    let rules =
        citadel_workspace_server_kernel::production_server_misc_settings().credential_requirements;
    assert_eq!(
        rules.max_username_length as usize,
        citadel_identity::MAX_USERNAME_BYTES
    );
    let name = "u".repeat(citadel_identity::MAX_USERNAME_BYTES);
    rules
        .check::<_, &str, _>(&name, None, "Full Name")
        .expect("255");
    assert!(rules
        .check::<_, &str, _>(format!("{name}u"), None, "Full Name")
        .is_err());
}

#[tokio::test(flavor = "multi_thread")]
async fn the_production_server_refuses_a_bare_name_and_registers_a_domain_name() {
    citadel_logging::setup_log();
    let addr = start_production_server().await;
    let bare = username("bob").replace(&format!("@{TEST_CANONICAL_DOMAIN}"), "");
    drive(move |remote| async move {
        let refused = remote
            .register_with_defaults(
                addr,
                "Bob Brown",
                bare.as_str(),
                PASSWORD,
                TEST_SERVER_CERTIFICATE,
            )
            .await
            .map(|_| ())
            .expect_err("a bare name registered");
        let expected = format!("canonical={TEST_CANONICAL_DOMAIN}");
        assert!(format!("{refused:?}").contains(&expected), "{refused:?}");
        let named = format!("{bare}@{TEST_CANONICAL_DOMAIN}");
        remote
            .register_with_defaults(
                addr,
                "Bob Brown",
                named.as_str(),
                PASSWORD,
                TEST_SERVER_CERTIFICATE,
            )
            .await?;
        Ok(())
    })
    .await
    .expect("the client ran");
}

/// The second gate: first-connect enrolment takes a legacy name or a name under one of the
/// server's domains, and nothing else.
#[test]
fn enrolment_takes_only_this_server_s_domains() {
    use citadel_workspace_server_kernel::kernel::server_identity::enrolment::enrolment_refusal;
    let accepted = acme().accepted_domains();
    for admitted in [
        "john.doe",
        "alice@acme.example",
        "alice@acme.work.avarok.net",
    ] {
        assert_eq!(enrolment_refusal(admitted, &accepted), None, "{admitted}");
    }
    let foreign = enrolment_refusal("alice@other.example", &accepted).expect("refused");
    assert!(foreign.contains("not a domain of this server"), "{foreign}");
    assert!(enrolment_refusal("alice@acme.example", &[]).is_some());
}
