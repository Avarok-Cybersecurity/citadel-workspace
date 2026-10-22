//! Uninstalling with and without `purge_storage`: what an app stored at its scope goes, or
//! stays for the next install there, and nothing at another scope is touched.

use super::kernel_call_tests::{get, set};
use super::test_manifests::*;
use super::test_runtime::*;
use super::test_support::apps_keys;
use citadel_app_sdk_types::calls::{BlobPut, KvBackend, KvValue};
use citadel_app_sdk_types::ops::StorageOps;
use citadel_app_sdk_types::{HostCall, HostReply};
use citadel_workspace_types::apps::{Capability, InstallScope};
use citadel_workspace_types::apps_protocol::AppsRequest;
use citadel_workspace_types::apps_responses::AppsResponse;

const CAPS: &[Capability] = &[Capability::StorageUser, Capability::StorageBlob];

/// The keys app storage holds now.
fn storage_keys(kernel: &super::test_support::Kernel) -> Vec<String> {
    let storage = [".ledger.", ".kvindex.", ".kv.", ".blob.", ".blob_chunk."];
    let mut keys: Vec<String> = apps_keys(kernel)
        .into_keys()
        .filter(|key| storage.iter().any(|part| key.contains(part)))
        .collect();
    keys.sort();
    keys
}

async fn store_some(kernel: &super::test_support::Kernel, id: &str) {
    let ok: HostReply<()> = call(kernel, "alice", id, &set(KvBackend::User, "k", b"v")).await;
    assert_eq!(ok, HostReply::Ok(()));
    let blob = HostCall::Storage(StorageOps::BlobPut(BlobPut {
        bytes: vec![7; 1000].into(),
    }));
    let put: HostReply<serde::de::IgnoredAny> = call(kernel, "alice", id, &blob).await;
    assert!(matches!(put, HostReply::Ok(_)));
}

async fn uninstall(kernel: &super::test_support::Kernel, id: &str, purge_storage: bool) {
    let request = AppsRequest::Uninstall {
        install_id: id.to_string(),
        purge_storage,
    };
    let answer = ask_on(kernel, "boss", None, request).await;
    assert!(
        matches!(answer, AppsResponse::Uninstalled { .. }),
        "{answer:?}"
    );
}

#[tokio::test]
async fn a_purging_uninstall_leaves_nothing_of_the_app_s_storage() {
    let kernel = workspace_serving(wasm(1, 4096)).await;
    let id = install(&kernel, "boss", InstallScope::Workspace, CAPS).await;
    store_some(&kernel, &id).await;
    assert!(
        storage_keys(&kernel).len() >= 5,
        "{:?}",
        storage_keys(&kernel)
    );
    uninstall(&kernel, &id, true).await;
    assert_eq!(storage_keys(&kernel), Vec::<String>::new());
}

#[tokio::test]
async fn an_uninstall_that_keeps_storage_hands_it_to_the_next_install_there() {
    let kernel = workspace_serving(wasm(1, 4096)).await;
    let id = install(&kernel, "boss", InstallScope::Workspace, CAPS).await;
    store_some(&kernel, &id).await;
    let before = storage_keys(&kernel);
    uninstall(&kernel, &id, false).await;
    assert_eq!(storage_keys(&kernel), before);
    let again = install(&kernel, "boss", InstallScope::Workspace, CAPS).await;
    let read: HostReply<KvValue> = call(&kernel, "alice", &again, &get(KvBackend::User, "k")).await;
    let value = read.into_result().expect("read").value.map(|v| v.0);
    assert_eq!(value, Some(b"v".to_vec()));
}

#[tokio::test]
async fn a_purge_touches_only_its_own_scope() {
    let kernel = workspace_serving(wasm(1, 4096)).await;
    let here = install(&kernel, "boss", InstallScope::Workspace, CAPS).await;
    let there = install(
        &kernel,
        "boss",
        InstallScope::SelfOnly("alice".into()),
        CAPS,
    )
    .await;
    store_some(&kernel, &here).await;
    store_some(&kernel, &there).await;
    uninstall(&kernel, &here, true).await;
    let read: HostReply<KvValue> = call(&kernel, "alice", &there, &get(KvBackend::User, "k")).await;
    let value = read.into_result().expect("read").value.map(|v| v.0);
    assert_eq!(value, Some(b"v".to_vec()));
    assert!(!storage_keys(&kernel).is_empty());
}
