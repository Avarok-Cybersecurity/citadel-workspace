//! App storage, hardened (S3): writes count toward the tenant's storage, every check is made
//! again under `APPS_LOCK`, a failed delete leaves nothing behind, and the host's `sys/` keys
//! are invisible.

use super::kernel_call_tests::{blob_put, get, set};
use super::kernel_peer_tests::{consent, pool};
use super::records::blob_chunk_key;
use super::storage::StorageRoot;
use super::storage_entitlement::StorageEntitlement;
use super::test_manifests::*;
use super::test_runtime::*;
use super::test_support::Kernel;
use crate::kernel::command_processor::async_process_command::process_command_with_user_and_cid;
use crate::kernel::limit::{storage_quota, StorageAnswer};
use crate::kernel::transaction::apps_store::APPS_LOCK;
use citadel_app_sdk_types::calls::{BlobDelete, BlobRef, KvBackend, KvList, KvPage, KvValue};
use citadel_app_sdk_types::ops::StorageOps;
use citadel_app_sdk_types::{encode, HostCall, HostReply, Refused};
use citadel_sdk::prelude::{async_trait, SqlHost, SqlRow, SqlStatement, StorageQuota};
use citadel_workspace_types::apps::{Capability, InstallScope};
use citadel_workspace_types::apps_protocol::AppsRequest;
use citadel_workspace_types::apps_responses::AppsResponse;
use citadel_workspace_types::structs::Permission;
use citadel_workspace_types::WorkspaceProtocolRequest;
use std::collections::HashSet;
use std::sync::Arc;

/// The Durable Object's storage as far as app storage asks it: the plan's entitlement, answered
/// through the same `limit::storage_quota` the real host's answer goes through. App storage never
/// runs SQL through it, so `execute` is refused.
struct PlanHost(parking_lot::Mutex<StorageAnswer>);

#[async_trait]
impl SqlHost for PlanHost {
    async fn execute(&self, _: Vec<SqlStatement>) -> Result<Vec<Vec<SqlRow>>, String> {
        Err("app storage runs no SQL through the host".to_string())
    }

    fn storage_quota(&self) -> Result<StorageQuota, String> {
        storage_quota(self.0.lock().clone())
    }
}

async fn planned(answer: StorageAnswer) -> (Kernel, Arc<PlanHost>) {
    let mut kernel = workspace_serving(wasm(1, 4096)).await;
    let host = Arc::new(PlanHost(parking_lot::Mutex::new(answer)));
    kernel.set_storage_entitlement(Some(StorageEntitlement::Host(host.clone())));
    (kernel, host)
}

fn over() -> HostReply<()> {
    HostReply::Refused(Refused::Limit("storage_gb".into()))
}

/// Replaces what `role` confers in the stored role table with `permissions`; answers what it conferred.
async fn confer(
    kernel: &Kernel,
    role: &str,
    permissions: Option<HashSet<Permission>>,
) -> HashSet<Permission> {
    let backend = &kernel.domain_operations.backend_tx_manager;
    let mut roles = backend
        .get_roles(crate::WORKSPACE_ROOT_ID)
        .await
        .expect("roles");
    let member = roles.get("member").expect("member").permissions.clone();
    let held = roles.roles.iter_mut().find(|r| r.id == role).expect("role");
    let was = std::mem::replace(&mut held.permissions, permissions.unwrap_or(member));
    backend
        .save_roles(crate::WORKSPACE_ROOT_ID, &roles)
        .await
        .expect("save");
    was
}

#[tokio::test]
async fn a_write_past_the_tenant_s_storage_is_refused_and_null_is_no_limit() {
    let (kernel, host) = planned(StorageAnswer::Integer(100)).await;
    let caps = [Capability::StorageUser];
    let both = [Capability::StorageUser, Capability::StorageBlob];
    let alices = install(&kernel, "boss", InstallScope::Workspace, &both).await;
    let user = KvBackend::User;
    let first: HostReply<()> =
        call(&kernel, "alice", &alices, &set(user.clone(), "a", &[1; 60])).await;
    assert_eq!(first, HostReply::Ok(()));
    let past: HostReply<()> =
        call(&kernel, "alice", &alices, &set(user.clone(), "b", &[1; 50])).await;
    assert_eq!(past, over(), "61 + 51 bytes is past 100");
    // Another root's bytes count too: bob's own install sees alice's 61.
    let bobs = install(&kernel, "boss", InstallScope::SelfOnly("bob".into()), &caps).await;
    let bob: HostReply<()> = call(&kernel, "bob", &bobs, &set(user.clone(), "c", &[1; 50])).await;
    assert_eq!(bob, over());
    // A write that shrinks storage is never refused, even past the limit.
    *host.0.lock() = StorageAnswer::Integer(10);
    let smaller: HostReply<()> =
        call(&kernel, "alice", &alices, &set(user.clone(), "a", &[1; 5])).await;
    assert_eq!(smaller, HostReply::Ok(()));
    let blob: HostReply<BlobRef> = call(&kernel, "alice", &alices, &blob_put(&[7; 64])).await;
    let blob_over = HostReply::Refused(Refused::Limit("storage_gb".into()));
    assert_eq!(blob, blob_over, "a blob counts too");
    *host.0.lock() = StorageAnswer::Null;
    let unlimited: HostReply<()> =
        call(&kernel, "bob", &bobs, &set(user.clone(), "c", &[1; 50])).await;
    assert_eq!(unlimited, HostReply::Ok(()));
    *host.0.lock() = StorageAnswer::Missing;
    let unknown: HostReply<()> = call(&kernel, "bob", &bobs, &set(user, "d", &[1; 5])).await;
    let unreadable = HostReply::Refused(Refused::Unavailable("storage_quota".into()));
    assert_eq!(unknown, unreadable, "a host that cannot say grants nothing");
}

#[tokio::test]
async fn every_check_is_made_again_once_the_lock_is_held() {
    let kernel = workspace_serving(wasm(1, 4096)).await;
    let id = install(
        &kernel,
        "boss",
        InstallScope::Workspace,
        &[Capability::StorageScope],
    )
    .await;
    let guard = APPS_LOCK.lock().await;
    let scope_write = set(KvBackend::Scope, "k", b"v");
    let write = call::<()>(&kernel, "boss", &id, &scope_write);
    let meanwhile = async {
        // The write passed its early checks and waits on the lock: boss's role, Admin, comes to
        // confer only what Member does.
        let admin = confer(&kernel, "admin", None).await;
        drop(guard);
        admin
    };
    let (written, admin) = tokio::join!(write, meanwhile);
    assert_ne!(
        written,
        HostReply::Ok(()),
        "decided on what was read before the lock"
    );
    // Restored, so the install grants a read again: nothing was written.
    confer(&kernel, "admin", Some(admin)).await;
    let read: HostReply<KvValue> = call(&kernel, "alice", &id, &get(KvBackend::Scope, "k")).await;
    assert_eq!(read.into_result().expect("read").value, None);
}

#[tokio::test]
async fn a_delete_that_failed_part_way_leaves_no_chunk_behind() {
    let kernel = workspace_serving(wasm(1, 4096)).await;
    let id = install(
        &kernel,
        "boss",
        InstallScope::Workspace,
        &[Capability::StorageBlob],
    )
    .await;
    let bytes: Vec<u8> = (0..300_000u32).map(|i| i as u8).collect();
    let put: HostReply<BlobRef> = call(&kernel, "boss", &id, &blob_put(&bytes)).await;
    let sha256 = put.into_result().expect("stored").sha256;
    let root = StorageRoot {
        app_id: APP_ID.into(),
        scope_key: "workspace".into(),
    };
    let backend = &kernel.domain_operations.backend_tx_manager;
    let second_chunk = blob_chunk_key(&root.id(), &sha256, 1);
    backend.fail_deletes_of(&second_chunk);
    let delete = HostCall::Storage(StorageOps::BlobDelete(BlobDelete {
        sha256: sha256.clone(),
    }));
    let request = WorkspaceProtocolRequest::Apps(AppsRequest::Call {
        install_id: id.clone(),
        call: encode(&delete),
    });
    let failed = process_command_with_user_and_cid(&kernel, &request, "boss", None).await;
    assert!(
        failed.is_err(),
        "the injected fault fails the delete: {failed:?}"
    );
    backend.clear_delete_fault(&second_chunk);
    let deleted: HostReply<()> = call(&kernel, "boss", &id, &delete).await;
    assert_eq!(deleted, HostReply::Ok(()));
    let left: Vec<String> = backend
        .stored_keys()
        .into_iter()
        .filter(|k| k.contains(&sha256))
        .collect();
    assert!(left.is_empty(), "orphaned: {left:?}");
}

#[tokio::test]
async fn the_host_s_own_keys_are_invisible_to_get_and_list() {
    let (kernel, id, _bob) = pool().await;
    consent(&kernel, "alice", &id, true).await;
    let claim = AppsRequest::TopicGroup {
        install_id: id.clone(),
        topic: "pool".into(),
        claim: Some("group-1".into()),
    };
    let claimed = ask_on(&kernel, "alice", None, claim).await;
    assert!(matches!(claimed, AppsResponse::TopicGroup { .. }));
    let got: HostReply<KvValue> = call(
        &kernel,
        "alice",
        &id,
        &get(KvBackend::Scope, "sys/topic/pool"),
    )
    .await;
    assert_eq!(got.into_result().expect("read").value, None);
    for prefix in ["", "sys/"] {
        let list = HostCall::Storage(StorageOps::KvList(KvList {
            backend: KvBackend::Scope,
            prefix: prefix.into(),
            cursor: None,
        }));
        let page: HostReply<KvPage> = call(&kernel, "alice", &id, &list).await;
        assert_eq!(
            page.into_result().expect("listed").keys,
            Vec::<String>::new()
        );
    }
}
