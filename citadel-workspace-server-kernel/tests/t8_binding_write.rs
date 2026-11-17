//! T8 (identity doc §6/§10 rev b): servers verify. `UpdateUserProfile.identity_binding` is
//! stored only when it is the actor's own, names one of this server's domains, is not more than
//! 300 s ahead of the server's clock, is newer than the stored one and its ML-DSA-65 signature
//! verifies; a text over 8192 characters is refused before any of that. Once stored, a member
//! who is not the owner's contact reads it, whatever the owner's stranger setting.
//!
//! Real: `check_binding_write`, `check_profile_update`, the command processor and
//! `profile_visibility`, over the contract's known-answer bindings.

use citadel_identity::{canonical_domain, CanonicalDomain, Identity, MAX_BINDING_BASE64_LEN};
use citadel_workspace_server_kernel::kernel::command_processor::async_process_command::process_command_with_user;
use citadel_workspace_server_kernel::kernel::identity_binding::{
    check_binding_write, BindingWrite, IDENTITY_BINDING_KEY,
};
use citadel_workspace_server_kernel::kernel::profile_limits::check_profile_update;
use citadel_workspace_server_kernel::kernel::profile_update::ProfileUpdate;
use citadel_workspace_server_kernel::kernel::profile_visibility::{metadata_for_viewer, Viewer};
use citadel_workspace_server_kernel::kernel::server_identity::hosted_identity;
use citadel_workspace_types::structs::{MetadataValue, User, UserRole};
use citadel_workspace_types::{WorkspaceProtocolRequest, WorkspaceProtocolResponse};
use common::identity_kat::{kat, seed, text};
use common::workspace_test_utils::create_configured_test_kernel;
use std::sync::Arc;

const ALICE: &str = "alice@acme.example";
/// The KAT's binding time, and a "now" 800 s after it.
const ISSUED: u64 = 1_794_700_000;
const NOW: u64 = ISSUED + 800;

fn acme() -> CanonicalDomain {
    canonical_domain("acme.example").unwrap()
}

fn kat_binding() -> String {
    let kat = kat();
    assert_eq!(text(&kat, "/identities/A/binding/username"), ALICE);
    text(&kat, "/identities/A/binding/blob_b64url").to_string()
}

fn alice() -> Identity {
    Identity::from_seed(&seed(&kat(), "/identities/A/seed_hex"))
}

fn write(blob: String, now_s: u64) -> BindingWrite {
    BindingWrite {
        blob_base64url: blob,
        accepted: vec![acme()],
        now_s,
    }
}

fn signed_at(issued_at_s: u64) -> String {
    alice()
        .sign_binding(ALICE, &acme(), issued_at_s)
        .unwrap()
        .to_base64url()
}

#[test]
fn the_contract_s_binding_is_accepted_for_its_own_account() {
    check_binding_write(&write(kat_binding(), NOW), ALICE, None).expect("the KAT binding");
    let legacy = text(&kat(), "/identities/A/legacy_binding/blob_b64url").to_string();
    check_binding_write(&write(legacy, NOW), "john.doe", None).expect("a legacy account binds");
}

#[test]
fn each_bad_write_is_refused() {
    let refused = |w: BindingWrite, actor: &str, stored: Option<&str>| {
        check_binding_write(&w, actor, stored).expect_err("accepted")
    };
    let other_actor = refused(write(kat_binding(), NOW), "bob@acme.example", None);
    assert!(other_actor.contains("signature"), "{other_actor}");

    let mut forged = citadel_identity::base64url_decode(&kat_binding()).unwrap();
    *forged.last_mut().unwrap() ^= 1;
    let forged = citadel_identity::base64url_encode(&forged);
    let bad_sig = refused(write(forged, NOW), ALICE, None);
    assert!(bad_sig.contains("signature"), "{bad_sig}");

    let future = refused(write(kat_binding(), ISSUED - 301), ALICE, None);
    assert!(future.contains("300s"), "{future}");
    check_binding_write(&write(kat_binding(), ISSUED - 300), ALICE, None).expect("within skew");

    let elsewhere = BindingWrite {
        accepted: vec![canonical_domain("other.example").unwrap()],
        ..write(kat_binding(), NOW)
    };
    let not_ours = refused(elsewhere, ALICE, None);
    assert!(
        not_ours.contains("not a domain of this server"),
        "{not_ours}"
    );
}

#[test]
fn a_binding_only_moves_forward() {
    let stored = kat_binding();
    let replay = check_binding_write(&write(kat_binding(), NOW), ALICE, Some(&stored)).unwrap_err();
    assert!(replay.contains("replay or a rollback"), "{replay}");
    let older = check_binding_write(&write(signed_at(ISSUED - 1), NOW), ALICE, Some(&stored));
    assert!(older.unwrap_err().contains("replay or a rollback"));
    check_binding_write(&write(signed_at(ISSUED + 1), NOW), ALICE, Some(&stored))
        .expect("a newer binding replaces the stored one");
}

#[test]
fn a_text_over_the_cap_is_refused_before_anything_is_read() {
    let update = |binding: String| ProfileUpdate {
        name: None,
        avatar_data: None,
        email: None,
        title: None,
        show_profile_to_strangers: None,
        accepts_requests_from_strangers: None,
        shows_online_status: None,
        identity_binding: Some(write(binding, NOW)),
    };
    let over = check_profile_update(&update("A".repeat(MAX_BINDING_BASE64_LEN + 1)));
    assert!(over.is_err(), "8193 characters were accepted");
    check_profile_update(&update(kat_binding())).expect("the KAT binding fits");
}

fn bind(binding: &str) -> WorkspaceProtocolRequest {
    WorkspaceProtocolRequest::UpdateUserProfile {
        name: None,
        avatar_data: None,
        email: None,
        title: None,
        show_profile_to_strangers: Some(false),
        accepts_requests_from_strangers: None,
        shows_online_status: None,
        identity_binding: Some(binding.to_string()),
    }
}

#[tokio::test]
async fn the_kernel_stores_a_verified_binding_and_a_stranger_reads_it() {
    let config = toml::from_str(
        "canonical_domain = \"acme.example\"\nformer_domains = []\ndiscovery = \"pinned\"\n",
    )
    .unwrap();
    let identity = Arc::new(hosted_identity(Some(&config), &[3; 32]).unwrap());
    let kernel =
        create_configured_test_kernel(move |k| k.set_server_identity(Some(identity))).await;
    kernel
        .domain_operations
        .backend_tx_manager
        .insert_user(
            ALICE.into(),
            User::new(ALICE.into(), "Alice".into(), UserRole::Member),
        )
        .await
        .unwrap();

    let stored = match process_command_with_user(&kernel, &bind(&kat_binding()), ALICE).await {
        Ok(WorkspaceProtocolResponse::UserProfileUpdated(user)) => user,
        other => panic!("the binding was not stored: {other:?}"),
    };
    let seen = metadata_for_viewer(
        &stored.metadata,
        Viewer::Other {
            is_admin: false,
            is_contact: false,
        },
    );
    assert_eq!(
        seen.get(IDENTITY_BINDING_KEY),
        Some(&MetadataValue::String(kat_binding())),
        "a stranger cannot read the binding of a hidden profile"
    );

    let replayed = process_command_with_user(&kernel, &bind(&kat_binding()), ALICE).await;
    assert!(
        matches!(&replayed, Ok(WorkspaceProtocolResponse::Error(e)) if e.contains("replay")),
        "{replayed:?}"
    );
}

#[tokio::test]
async fn a_kernel_with_no_identity_stores_no_binding() {
    let kernel = create_configured_test_kernel(|_| {}).await;
    let refused = process_command_with_user(&kernel, &bind(&kat_binding()), ALICE).await;
    assert!(
        matches!(&refused, Ok(WorkspaceProtocolResponse::Error(e)) if e.contains("[identity]")),
        "{refused:?}"
    );
}
