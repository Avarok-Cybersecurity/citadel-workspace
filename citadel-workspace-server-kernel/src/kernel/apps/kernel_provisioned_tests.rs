//! An install provisioning made (`first_party_provisioning`) has no member as its installer, yet
//! serves what it was granted: storage, its topic and an admin's consent to an update, for an
//! admin and a plain member alike. The acting member's own checks and their own consent still
//! apply, and a member whose username is the provisioning marker gains nothing by it.
//!
//! The release is the committed Calendar manifest, signed with a test key over a small module.

use super::first_party::SignedBundle;
use super::kernel_call_tests::{get, set};
use super::test_manifests::*;
use super::test_runtime::*;
use super::test_support::{ask, Kernel};
use crate::kernel::command_processor::PROVISIONING_INSTALLER;
use crate::WORKSPACE_ROOT_ID;
use citadel_app_sdk_types::calls::{KvBackend, KvList, KvPage};
use citadel_app_sdk_types::ops::StorageOps;
use citadel_app_sdk_types::{HostCall, HostReply, Refused};
use citadel_app_signature::{sha256, AppSigningKey, ArtifactDigests};
use citadel_workspace_types::apps::{Capability, InstallScope};
use citadel_workspace_types::apps_install::{AppsRefusal, InstallState};
use citadel_workspace_types::apps_protocol::{AppsRequest, ListingOffer};
use citadel_workspace_types::apps_responses::AppsResponse;
use citadel_workspace_types::structs::User;

const CALENDAR: &str = "net.avarok.calendar";

/// The committed Calendar at `version`, published by `key` over `module`: manifest and signature.
/// `sdk` replaces its ABI: only the first-party key may publish on the glue ABI, which no test
/// holds, so an update a test signs is on the app ABI.
fn calendar(
    key: &AppSigningKey,
    version: &str,
    module: &[u8],
    sdk: Option<serde_json::Value>,
) -> (Vec<u8>, String) {
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../apps/first-party/calendar/manifest.json"
    );
    let bytes = std::fs::read(path).expect("the committed Calendar manifest");
    let mut value: serde_json::Value = serde_json::from_slice(&bytes).expect("json");
    value["version"] = version.into();
    value["publisher"]["mldsa65_public_key"] = key.public_key_hex().into();
    value["artifact"]["sha256"] = hex::encode(sha256(module)).into();
    value["artifact"]["bytes"] = module.len().into();
    if let Some(sdk) = sdk {
        value["sdk"] = sdk;
    }
    let manifest = serde_json::to_vec(&value).expect("json");
    let digests = ArtifactDigests::of(&manifest, module);
    let signature = key.sign(CALENDAR, version, &digests).expect("sign");
    (manifest, signature)
}

/// A workspace provisioned with the Calendar, and the install's id.
async fn provisioned() -> (Kernel, String) {
    let kernel = workspace_serving(wasm(1, 4096)).await;
    let (key, module) = (publisher(1), wasm(5, 4096));
    let (manifest, signature) = calendar(&key, "0.1.0", &module, None);
    let bundle = SignedBundle {
        manifest: &manifest,
        signature: &signature,
        module: None,
    };
    let trusted = key.public_key_hex();
    kernel
        .provision_first_party_apps(&[("calendar", bundle)], &[trusted.as_str()])
        .await
        .expect("provisioned");
    let AppsResponse::Installs { installs, .. } =
        ask(&kernel, "boss", AppsRequest::ListInstalls).await
    else {
        panic!("no installs");
    };
    let install = installs
        .into_iter()
        .find(|i| i.app_id == CALENDAR)
        .expect("the Calendar");
    assert_eq!(install.installed_by, PROVISIONING_INSTALLER);
    (kernel, install.id)
}

fn list(prefix: &str) -> HostCall {
    HostCall::Storage(StorageOps::KvList(KvList {
        backend: KvBackend::User,
        prefix: prefix.to_string(),
        cursor: None,
    }))
}

async fn topic(kernel: &Kernel, who: &str, id: &str) -> AppsResponse {
    let request = AppsRequest::TopicGroup {
        install_id: id.into(),
        topic: "cal".into(),
        claim: None,
    };
    ask_on(kernel, who, None, request).await
}

async fn allow_topics(kernel: &Kernel, who: &str, id: &str) {
    let request = AppsRequest::SetPeerConsentForMe {
        install_id: id.into(),
        serve: false,
        call: false,
        topics: true,
    };
    ask_on(kernel, who, None, request).await;
}

#[tokio::test]
async fn a_provisioned_install_serves_each_member_s_own_store() {
    let (kernel, id) = provisioned().await;
    for who in ["boss", "alice"] {
        let settings = set(KvBackend::User, "cal/settings", b"{}");
        let wrote: HostReply<()> = call(&kernel, who, &id, &settings).await;
        assert_eq!(wrote, HostReply::Ok(()), "{who}: KvSet");
        let listed: HostReply<KvPage> = call(&kernel, who, &id, &list("cal/reminder/")).await;
        assert!(
            matches!(listed, HostReply::Ok(_)),
            "{who}: KvList {listed:?}"
        );
    }
}

#[tokio::test]
async fn a_provisioned_install_still_takes_the_acting_member_s_own_view() {
    let (kernel, id) = provisioned().await;
    // carol holds no ViewContent at the root, which storage.user needs of the acting member.
    let read: HostReply<serde::de::IgnoredAny> =
        call(&kernel, "carol", &id, &get(KvBackend::User, "k")).await;
    assert_eq!(read, HostReply::Refused(Refused::Ungranted));
}

#[tokio::test]
async fn a_provisioned_install_s_topic_answers_a_member_who_allowed_topics() {
    let (kernel, id) = provisioned().await;
    for who in ["boss", "alice"] {
        assert_eq!(
            topic(&kernel, who, &id).await,
            AppsResponse::Refused(AppsRefusal::Unavailable),
            "{who}: not before the member allowed topics"
        );
        allow_topics(&kernel, who, &id).await;
        let answer = topic(&kernel, who, &id).await;
        assert!(
            matches!(answer, AppsResponse::TopicGroup { .. }),
            "{who}: {answer:?}"
        );
    }
}

#[tokio::test]
async fn an_admin_consents_to_an_update_of_a_provisioned_install() {
    let (kernel, id) = provisioned().await;
    let (next_key, module) = (publisher(2), wasm(6, 4096));
    let app_abi = serde_json::json!({ "abi": "citadel-app-abi-1", "min": "1.0.0", "max": "1.x" });
    upload(&kernel, "boss", &module).await;
    let (manifest_bytes, signature) = calendar(&next_key, "0.2.0", &module, Some(app_abi));
    let listing = ListingOffer::Signed {
        manifest_bytes,
        signature,
    };
    let update = AppsRequest::Update {
        install_id: id.clone(),
        listing,
    };
    let install = match ask(&kernel, "boss", update).await {
        AppsResponse::Updated { install } => install,
        other => panic!("not updated: {other:?}"),
    };
    assert!(
        matches!(install.state, InstallState::NeedsConsent { .. }),
        "another key"
    );
    let consent = AppsRequest::Consent {
        install_id: id,
        version: "0.2.0".into(),
        granted: install.granted.iter().copied().collect(),
        pinned_publisher_key: next_key.public_key_hex(),
    };
    let answer = ask(&kernel, "boss", consent).await;
    assert!(
        matches!(answer, AppsResponse::Consented { .. }),
        "{answer:?}"
    );
}

/// A member made through the ordinary install path, whatever their username, is narrowed to
/// what they still hold: here one named like the marker, demoted after installing.
#[tokio::test]
async fn a_member_named_like_the_marker_is_narrowed_as_any_installer() {
    let kernel = workspace_serving(wasm(1, 4096)).await;
    let backend = &kernel.domain_operations.backend_tx_manager;
    let as_role = |role: &str| User {
        workspace_roles: std::iter::once((WORKSPACE_ROOT_ID.to_string(), role.to_string()))
            .collect(),
        ..User::new(PROVISIONING_INSTALLER.to_string(), "Named".to_string())
    };
    backend
        .insert_user(PROVISIONING_INSTALLER.into(), as_role("appadmin"))
        .await
        .expect("user");
    let mut workspace = backend
        .get_workspace(WORKSPACE_ROOT_ID)
        .await
        .expect("read")
        .expect("root");
    workspace.members.push(PROVISIONING_INSTALLER.to_string());
    backend
        .insert_workspace(WORKSPACE_ROOT_ID.into(), workspace)
        .await
        .expect("save");
    let scope = InstallScope::Workspace;
    let id = install(
        &kernel,
        PROVISIONING_INSTALLER,
        scope,
        &[Capability::StorageUser],
    )
    .await;
    let read = get(KvBackend::User, "k");
    let before: HostReply<serde::de::IgnoredAny> = call(&kernel, "alice", &id, &read).await;
    assert!(
        matches!(before, HostReply::Ok(_)),
        "served while the installer may grant storage"
    );
    backend
        .update_user(PROVISIONING_INSTALLER, as_role("member"))
        .await
        .expect("demote");
    let after: HostReply<serde::de::IgnoredAny> = call(&kernel, "alice", &id, &read).await;
    assert_eq!(after, HostReply::Refused(Refused::Ungranted));
}

/// The comparison: the same storage calls through an install an admin made are served.
#[tokio::test]
async fn an_admin_s_install_serves_a_member_s_own_store() {
    let kernel = workspace_serving(wasm(1, 4096)).await;
    let id = install(
        &kernel,
        "boss",
        InstallScope::Workspace,
        &[Capability::StorageUser],
    )
    .await;
    let listed: HostReply<KvPage> = call(&kernel, "alice", &id, &list("cal/reminder/")).await;
    assert!(matches!(listed, HostReply::Ok(_)), "{listed:?}");
}

/// Provisioning holds what installing takes and nothing that manages, moderates or reads.
#[test]
fn provisioning_holds_only_what_an_installer_grants_with() {
    use super::rules::provisioning_holds;
    use citadel_workspace_types::structs::Permission;
    assert!(provisioning_holds(Permission::AppInstall));
    assert!(provisioning_holds(Permission::AppInstallAllowStorage));
    assert!(provisioning_holds(Permission::AppInstallAllowGroupTopics));
    for never in [
        Permission::All,
        Permission::AppManage,
        Permission::ViewContent,
    ] {
        assert!(!provisioning_holds(never), "{never:?}");
    }
}
