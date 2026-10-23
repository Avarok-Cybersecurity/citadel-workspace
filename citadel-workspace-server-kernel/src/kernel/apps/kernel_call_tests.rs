//! `Call` through the kernel: the capability is re-checked on every call, and the storage
//! backends keep each namespace to itself and within its limits.

use super::test_manifests::*;
use super::test_runtime::*;
use crate::WORKSPACE_ROOT_ID;
use citadel_app_sdk_types::calls::*;
use citadel_app_sdk_types::ops::{NetOps, StorageOps};
use citadel_app_sdk_types::{HostCall, HostReply, Refused};
use citadel_workspace_types::apps::{Capability, InstallScope};
use citadel_workspace_types::apps_responses::AppsResponse;

pub(crate) fn set(backend: KvBackend, key: &str, value: &[u8]) -> HostCall {
    HostCall::Storage(StorageOps::KvSet(KvSet {
        backend,
        key: key.to_string(),
        value: value.to_vec().into(),
    }))
}

pub(crate) fn get(backend: KvBackend, key: &str) -> HostCall {
    HostCall::Storage(StorageOps::KvGet(KvGet {
        backend,
        key: key.to_string(),
    }))
}

pub(crate) fn node(id: &str) -> KvBackend {
    KvBackend::Node {
        node_id: id.to_string(),
    }
}

pub(crate) fn fetch() -> HostCall {
    HostCall::Net(NetOps::ServerFetch(ServerFetch {
        request: super::egress_tests::get("https://api.acme.example/v1"),
    }))
}

pub(crate) fn blob_put(bytes: &[u8]) -> HostCall {
    HostCall::Storage(StorageOps::BlobPut(BlobPut {
        bytes: bytes.to_vec().into(),
    }))
}

pub(crate) fn value(reply: HostReply<KvValue>) -> Option<Vec<u8>> {
    reply.into_result().expect("served").value.map(|v| v.0)
}

/// One call per group the server serves, each needing a different capability.
fn one_per_group() -> Vec<(Capability, HostCall)> {
    vec![
        (Capability::StorageUser, get(KvBackend::User, "k")),
        (Capability::StorageScope, get(KvBackend::Scope, "k")),
        (Capability::StorageNode, get(node("room"), "k")),
        (Capability::StorageBlob, blob_put(b"blob")),
        (Capability::NetServer, fetch()),
    ]
}

#[tokio::test]
async fn every_server_group_answers_ungranted_without_its_capability() {
    let kernel = workspace_serving(wasm(1, 4096)).await;
    let id = install(&kernel, "boss", InstallScope::Workspace, &[]).await;
    for (cap, call) in one_per_group() {
        let reply: HostReply<()> = super::test_runtime::call(&kernel, "boss", &id, &call).await;
        assert_eq!(reply, HostReply::Refused(Refused::Ungranted), "{cap:?}");
    }
}

#[tokio::test]
async fn each_group_is_served_once_its_capability_is_granted() {
    let kernel = workspace_serving(wasm(1, 4096)).await;
    for (cap, call) in one_per_group() {
        let id = install(
            &kernel,
            "boss",
            InstallScope::SelfOnly("boss".into()),
            &[cap],
        )
        .await;
        let reply = call_raw(&kernel, "boss", &id, &call).await;
        let AppsResponse::CallReply { reply } = reply else {
            panic!("{cap:?}: {reply:?}");
        };
        let reply: HostReply<serde::de::IgnoredAny> =
            citadel_app_sdk_types::decode(&reply).expect("reply");
        assert_ne!(reply, HostReply::Refused(Refused::Ungranted), "{cap:?}");
        let uninstall = citadel_workspace_types::apps_protocol::AppsRequest::Uninstall {
            install_id: id,
            purge_storage: true,
        };
        ask_on(&kernel, "boss", None, uninstall).await;
    }
}

#[tokio::test]
async fn a_member_s_own_store_is_theirs_alone() {
    let kernel = workspace_serving(wasm(1, 4096)).await;
    let id = install(
        &kernel,
        "boss",
        InstallScope::Workspace,
        &[Capability::StorageUser],
    )
    .await;
    let ok: HostReply<()> = call(&kernel, "alice", &id, &set(KvBackend::User, "k", b"mine")).await;
    assert_eq!(ok, HostReply::Ok(()));
    let alice = call(&kernel, "alice", &id, &get(KvBackend::User, "k")).await;
    assert_eq!(value(alice), Some(b"mine".to_vec()));
    let bob = call(&kernel, "bob", &id, &get(KvBackend::User, "k")).await;
    assert_eq!(value(bob), None);
}

#[tokio::test]
async fn a_shared_write_takes_the_member_s_own_permission() {
    let kernel = workspace_serving(wasm(1, 4096)).await;
    let id = install(
        &kernel,
        "boss",
        InstallScope::Workspace,
        &[Capability::StorageScope],
    )
    .await;
    let alice: HostReply<()> = call(&kernel, "alice", &id, &set(KvBackend::Scope, "k", b"a")).await;
    assert_eq!(
        alice,
        HostReply::Refused(Refused::Policy("permission".into()))
    );
    let boss: HostReply<()> = call(&kernel, "boss", &id, &set(KvBackend::Scope, "k", b"b")).await;
    assert_eq!(boss, HostReply::Ok(()));
    let read = call(&kernel, "alice", &id, &get(KvBackend::Scope, "k")).await;
    assert_eq!(value(read), Some(b"b".to_vec()));
}

#[tokio::test]
async fn a_node_outside_the_install_s_tree_is_ungranted() {
    let kernel = workspace_serving(wasm(1, 4096)).await;
    let scope = InstallScope::NodeTree("office".into());
    let id = install(&kernel, "boss", scope, &[Capability::StorageNode]).await;
    let inside: HostReply<()> = call(&kernel, "boss", &id, &set(node("room"), "k", b"v")).await;
    assert_eq!(inside, HostReply::Ok(()));
    let outside: HostReply<()> = call(
        &kernel,
        "boss",
        &id,
        &set(node(WORKSPACE_ROOT_ID), "k", b"v"),
    )
    .await;
    assert_eq!(outside, HostReply::Refused(Refused::Ungranted));
    let missing: HostReply<()> = call(&kernel, "boss", &id, &set(node("nowhere"), "k", b"v")).await;
    assert_eq!(missing, HostReply::Refused(Refused::Ungranted));
}

#[tokio::test]
async fn a_demoted_installer_s_install_loses_the_capability_at_the_next_call() {
    let kernel = workspace_serving(wasm(1, 4096)).await;
    let id = install(
        &kernel,
        "mgr",
        InstallScope::Workspace,
        &[Capability::StorageUser],
    )
    .await;
    let before: HostReply<()> = call(&kernel, "alice", &id, &set(KvBackend::User, "k", b"v")).await;
    assert_eq!(before, HostReply::Ok(()));
    // appadmin, mgr's role, stops conferring the grant's `AppInstallAllow*`.
    let backend = &kernel.domain_operations.backend_tx_manager;
    let mut roles = backend.get_roles(WORKSPACE_ROOT_ID).await.expect("roles");
    for role in roles.roles.iter_mut().filter(|r| r.id == "appadmin") {
        role.permissions
            .remove(&citadel_workspace_types::structs::Permission::AppInstallAllowStorage);
    }
    backend
        .save_roles(WORKSPACE_ROOT_ID, &roles)
        .await
        .expect("save");
    let after: HostReply<()> = call(&kernel, "alice", &id, &set(KvBackend::User, "k", b"v")).await;
    assert_eq!(after, HostReply::Refused(Refused::Ungranted));
}

#[tokio::test]
async fn a_store_stays_within_the_quota_its_manifest_declared() {
    let kernel = workspace_serving(wasm(1, 4096)).await;
    let id = install(
        &kernel,
        "boss",
        InstallScope::Workspace,
        &[Capability::StorageUser],
    )
    .await;
    // The test manifest declares 1024 bytes for `storage_user_bytes`, under the platform's MiB.
    let fits: HostReply<()> = call(
        &kernel,
        "alice",
        &id,
        &set(KvBackend::User, "a", &[0; 1000]),
    )
    .await;
    assert_eq!(fits, HostReply::Ok(()));
    let over: HostReply<()> =
        call(&kernel, "alice", &id, &set(KvBackend::User, "b", &[0; 100])).await;
    assert_eq!(over, HostReply::Refused(Refused::Limit("quota".into())));
    let unchanged = call(&kernel, "alice", &id, &get(KvBackend::User, "b")).await;
    assert_eq!(value(unchanged), None);
}
