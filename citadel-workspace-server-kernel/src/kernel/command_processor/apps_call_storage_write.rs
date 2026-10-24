//! App storage writes under `APPS_LOCK` (R4.5): every check that decides a write is made again
//! once the lock is held, against the install as it is then, and the write lands in the order
//! `kernel::apps::storage_write` gives, within the tenant's entitlement.
//!
//! The checks made before the lock (in `apps_call`) only refuse early; what was read then is
//! never used to decide. Under the lock the install is read again, and must still be running,
//! still grant the op to the member at the target, and the member must still hold the backend's
//! own permission there. Its root, namespace and quota come from that read.

use super::apps::Step;
use super::apps_call::reply_refused;
use super::apps_call_storage::{quota_for, refused, root_of, unavailable};
use super::apps_gather::{effective_for, holds_at};
use super::apps_lifecycle::reread;
use crate::kernel::apps::storage::{key_id, Namespace, StorageRoot};
use crate::kernel::apps::storage_write::{staged, within_entitlement};
use crate::kernel::async_kernel::AsyncWorkspaceServerKernel;
use crate::kernel::transaction::apps_store::APPS_LOCK;
use citadel_app_sdk_types::ops::StorageOps;
use citadel_app_sdk_types::Refused;
use citadel_logging::warn;
use citadel_sdk::prelude::Ratchet;
use citadel_workspace_types::apps_install::{AppInstall, InstallState};
use citadel_workspace_types::structs::Permission;

/// What a write is refused with when the tenant's entitlement cannot be read.
const NO_ENTITLEMENT: &str = "storage_quota";

/// One write, as checked before the lock: who, where, what, and the member permission it needs.
pub(super) struct Write<'a> {
    pub install_id: &'a str,
    pub user: &'a str,
    pub target: &'a str,
    pub op: &'a StorageOps,
    pub needs: Option<Permission>,
}

/// With `APPS_LOCK` held by the caller: the install as it is now, if it still admits `write`; otherwise the
/// refusal to answer.
pub(super) async fn recheck<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    write: &Write<'_>,
) -> Step<Result<AppInstall, Vec<u8>>> {
    let install = reread(kernel, write.install_id).await?;
    if matches!(install.state, InstallState::Suspended { .. }) {
        return Ok(Err(reply_refused(Refused::Unavailable(
            "suspended".to_string(),
        ))));
    }
    let effective = effective_for(kernel, &install, write.user, write.target).await?;
    if !write.op.granted_by().iter().any(|c| effective.contains(c)) {
        return Ok(Err(reply_refused(Refused::Ungranted)));
    }
    if let Some(permission) = write.needs {
        if !holds_at(kernel, write.user, write.target, permission).await? {
            return Ok(Err(reply_refused(Refused::Policy(
                "permission".to_string(),
            ))));
        }
    }
    Ok(Ok(install))
}

/// Whether taking `root` from `current` to `next` bytes stays within the tenant's entitlement;
/// `Some` is the refusal. A write that does not grow storage is never refused here.
pub(super) async fn entitled<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    root: &StorageRoot,
    current: u64,
    next: u64,
) -> Step<Option<Vec<u8>>> {
    if next <= current {
        return Ok(None);
    }
    let Some(entitlement) = kernel.storage_entitlement() else {
        return Ok(Some(unavailable(NO_ENTITLEMENT)));
    };
    let quota = match entitlement.quota() {
        Ok(quota) => quota,
        Err(why) => {
            warn!(target: "citadel", "[APPS] An app storage write was refused: {why}");
            return Ok(Some(unavailable(NO_ENTITLEMENT)));
        }
    };
    let backend = &kernel.domain_operations.backend_tx_manager;
    let others = backend.app_storage_besides(root).await?;
    Ok(within_entitlement(others, current, next, quota)
        .err()
        .map(refused))
}

/// One KV write of `writes` (a value, or `None` to delete) to `namespace`, under `APPS_LOCK`.
pub(super) async fn kv_write<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    write: &Write<'_>,
    namespace: &Namespace,
    writes: &[(&str, Option<&[u8]>)],
) -> Step<Vec<u8>> {
    let backend = &kernel.domain_operations.backend_tx_manager;
    let _guard = APPS_LOCK.lock().await;
    let install = match recheck(kernel, write).await? {
        Ok(install) => install,
        Err(refusal) => return Ok(refusal),
    };
    let root = root_of(&install)?;
    let id = root.namespace_id(namespace);
    let index = backend.kv_index(&id).await?;
    let lengths: Vec<(&str, Option<usize>)> = writes
        .iter()
        .map(|(k, v)| (*k, v.map(<[u8]>::len)))
        .collect();
    let quota = quota_for(kernel, &install, namespace).await?;
    let next = match index.apply(&lengths, quota) {
        Ok(next) => next,
        Err(why) => return Ok(refused(why)),
    };
    let mut ledger = backend.app_ledger(&root).await?;
    let current = ledger.total_bytes();
    let recorded = ledger.namespaces.get(&id).copied().unwrap_or(0);
    let after = current
        .saturating_sub(recorded)
        .saturating_add(next.usage());
    if let Some(refusal) = entitled(kernel, &root, current, after).await? {
        return Ok(refusal);
    }
    let staging = staged(&index, &next);
    if staging != index {
        backend.save_kv_index(&id, &staging).await?;
        ledger.record_namespace(id.clone(), staging.usage());
        backend.save_app_ledger(&root, &ledger).await?;
    }
    for (key, value) in writes {
        backend.put_kv_value(&id, &key_id(key), *value).await?;
    }
    backend.save_kv_index(&id, &next).await?;
    ledger.record_namespace(id, next.usage());
    backend.save_app_ledger(&root, &ledger).await?;
    Ok(super::apps_call::reply_ok(()))
}
