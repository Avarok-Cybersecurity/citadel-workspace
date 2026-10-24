//! The storage group of `Call` (R4.5), after `apps_call` re-checked the capability: the KV
//! backends `storage.user`, `.scope` and `.node`, and `storage.blob`.
//!
//! The namespace comes from the install (app id and scope key) and the session (the member),
//! never from the call. A shared write also takes the member's own permission: `EditContent`
//! on the scope's node for `storage.scope`, `EditMdx` on the node for `storage.node`. Every
//! write is made under `APPS_LOCK`, against the install as it is then, so an uninstall's purge
//! and a write never interleave. `storage.local` is the member's agent's, and `storage.files`
//! is not served by this server yet: both are answered `unavailable`.

use super::apps::{Caller, Step};
use super::apps_call::{reply_ok, reply_refused};
use super::apps_call_blob::{blob_delete, blob_get, blob_put};
use super::apps_gather::holds_at;
use super::apps_lifecycle::reread;
use crate::kernel::apps::storage::*;
use crate::kernel::async_kernel::AsyncWorkspaceServerKernel;
use crate::kernel::transaction::apps_store::APPS_LOCK;
use citadel_app_sdk_types::calls::{KvBackend, KvPage, KvValue};
use citadel_app_sdk_types::ops::StorageOps;
use citadel_app_sdk_types::Refused;
use citadel_sdk::prelude::{NetworkError, Ratchet};
use citadel_workspace_types::apps_install::{AppInstall, AppsRefusal};
use citadel_workspace_types::apps_manifest::AppManifest;
use citadel_workspace_types::structs::Permission;

/// One key and the value written to it, or `None` to delete it.
type KvWrite<'a> = (&'a str, Option<&'a [u8]>);

pub(super) fn refused(why: StorageRefusal) -> Vec<u8> {
    reply_refused(match why {
        StorageRefusal::Limit(what) => Refused::Limit(what.to_string()),
        StorageRefusal::Policy(why) => Refused::Policy(why.to_string()),
    })
}

pub(super) fn unavailable(what: &str) -> Vec<u8> {
    reply_refused(Refused::Unavailable(what.to_string()))
}

pub(super) fn root_of(install: &AppInstall) -> Step<StorageRoot> {
    let scope_key = install.scope.scope_key().ok_or(AppsRefusal::Unavailable)?;
    Ok(StorageRoot {
        app_id: install.app_id.clone(),
        scope_key,
    })
}

/// The namespace `backend` names for `caller`, and the permission a write to it takes; None for
/// the host-local backend.
fn namespace_of(
    backend: &KvBackend,
    caller: &Caller<'_>,
) -> Option<(Namespace, Option<Permission>)> {
    match backend {
        KvBackend::User => Some((Namespace::User(caller.user.to_string()), None)),
        KvBackend::Scope => Some((Namespace::Scope, Some(Permission::EditContent))),
        KvBackend::Node { node_id } => {
            Some((Namespace::Node(node_id.clone()), Some(Permission::EditMdx)))
        }
        KvBackend::Local => None,
    }
}

/// A namespace's cap: the platform's, or less where the app's manifest asks for less
/// (`limits.storage_user_bytes`, `.storage_scope_bytes`), which is what its consent screen said.
pub(super) async fn quota_for<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    install: &AppInstall,
    namespace: &Namespace,
) -> Step<u64> {
    let backend = &kernel.domain_operations.backend_tx_manager;
    let missing = || NetworkError::msg(format!("The release of install {} is missing", install.id));
    let release = backend
        .app_release(&install.manifest_sha256)
        .await?
        .ok_or_else(missing)?;
    let manifest = AppManifest::from_bytes(release.manifest.as_bytes())
        .map_err(|why| NetworkError::msg(format!("A stored manifest does not read: {why}")))?;
    let declared = match namespace {
        Namespace::User(_) => Some(manifest.limits.storage_user_bytes),
        Namespace::Scope => Some(manifest.limits.storage_scope_bytes),
        Namespace::Node(_) => None,
    };
    let platform = quota_of(namespace);
    Ok(declared.map_or(platform, |bytes| platform.min(u64::from(bytes))))
}

pub(super) async fn serve_storage<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    caller: &Caller<'_>,
    install: &AppInstall,
    target: &str,
    op: &StorageOps,
) -> Step<Vec<u8>> {
    let root = root_of(install)?;
    let backend = &kernel.domain_operations.backend_tx_manager;
    let (kv, writes): (&KvBackend, Vec<KvWrite<'_>>) = match op {
        StorageOps::KvGet(a) => {
            let Some((namespace, _)) = namespace_of(&a.backend, caller) else {
                return Ok(unavailable("host_local"));
            };
            let id = root.namespace_id(&namespace);
            if check_key(&a.key).is_err() || !backend.kv_index(&id).await?.keys.contains_key(&a.key)
            {
                return Ok(reply_ok(KvValue { value: None }));
            }
            let value = backend.kv_value(&id, &key_id(&a.key)).await?;
            return Ok(reply_ok(KvValue {
                value: value.map(Into::into),
            }));
        }
        StorageOps::KvList(a) => {
            let Some((namespace, _)) = namespace_of(&a.backend, caller) else {
                return Ok(unavailable("host_local"));
            };
            let index = backend.kv_index(&root.namespace_id(&namespace)).await?;
            let (keys, next) = index.page(&a.prefix, a.cursor.as_deref());
            return Ok(reply_ok(KvPage { keys, next }));
        }
        StorageOps::KvSet(a) => (
            &a.backend,
            vec![(a.key.as_str(), Some(a.value.0.as_slice()))],
        ),
        StorageOps::KvDelete(a) => (&a.backend, vec![(a.key.as_str(), None)]),
        StorageOps::KvSetMany(a) => {
            if a.entries.len() > KV_MAX_SET_MANY {
                return Ok(refused(StorageRefusal::Limit("entries")));
            }
            let writes = a
                .entries
                .iter()
                .map(|e| (e.key.as_str(), Some(e.value.0.as_slice())));
            (&a.backend, writes.collect())
        }
        StorageOps::BlobPut(a) => return blob_put(kernel, install, &root, &a.bytes.0).await,
        StorageOps::BlobGet(a) => return blob_get(kernel, &root, &a.sha256).await,
        StorageOps::BlobDelete(a) => return blob_delete(kernel, install, &root, &a.sha256).await,
        StorageOps::StoreFileWrite(_)
        | StorageOps::StoreFileRead(_)
        | StorageOps::StoreFileList(_) => {
            return Ok(unavailable("files"));
        }
    };
    let Some((namespace, needs)) = namespace_of(kv, caller) else {
        return Ok(unavailable("host_local"));
    };
    if let Some(Err(why)) = writes
        .iter()
        .map(|(k, _)| check_app_write(k))
        .find(Result::is_err)
    {
        return Ok(refused(why));
    }
    if let Some(permission) = needs {
        if !holds_at(kernel, caller.user, target, permission).await? {
            return Ok(reply_refused(Refused::Policy("permission".to_string())));
        }
    }
    let _guard = APPS_LOCK.lock().await;
    reread(kernel, &install.id).await?;
    let id = root.namespace_id(&namespace);
    let index = backend.kv_index(&id).await?;
    let lengths: Vec<(&str, Option<usize>)> = writes
        .iter()
        .map(|(k, v)| (*k, v.map(<[u8]>::len)))
        .collect();
    let quota = quota_for(kernel, install, &namespace).await?;
    let next = match index.apply(&lengths, quota) {
        Ok(next) => next,
        Err(why) => return Ok(refused(why)),
    };
    for (key, value) in &writes {
        backend.put_kv_value(&id, &key_id(key), *value).await?;
    }
    backend.save_kv_index(&id, &next).await?;
    let mut ledger = backend.app_ledger(&root).await?;
    ledger.record_namespace(id, next.usage());
    backend.save_app_ledger(&root, &ledger).await?;
    Ok(reply_ok(()))
}
