//! `TopicGroup`: which Citadel group carries a topic of an install. The first member whose agent
//! creates the group records its key; everyone else reads it and asks to join. The record is the
//! scope KV's reserved key `sys/topic/<name>` (`storage::topic_key`), which no app write may
//! name, so an app can neither forge nor erase it.

use super::apps::{finish, Answer, Caller, Halt};
use super::apps_call_storage::{quota_for, root_of};
use super::apps_gather::effective_for;
use super::apps_ihttp_target::reaches;
use super::apps_lifecycle::reread;
use super::apps_member::visible_install;
use crate::kernel::apps::facts::authority_node;
use crate::kernel::apps::storage::{key_id, topic_key, Namespace, StorageRefusal};
use crate::kernel::async_kernel::AsyncWorkspaceServerKernel;
use crate::kernel::transaction::apps_store::APPS_LOCK;
use crate::WORKSPACE_ROOT_ID;
use citadel_sdk::prelude::Ratchet;
use citadel_workspace_types::apps::Capability;
use citadel_workspace_types::apps_install::{AppsRefusal, InstallState};
use citadel_workspace_types::apps_responses::AppsResponse;

/// A group key is the agent's printed `MessageGroupKey`; anything longer is not one.
pub const MAX_GROUP_KEY_BYTES: usize = 256;

pub(super) async fn topic_group<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    caller: &Caller<'_>,
    install_id: &str,
    topic: &str,
    claim: Option<&str>,
) -> Answer {
    let step = async {
        let backend = &kernel.domain_operations.backend_tx_manager;
        let (install, _) = visible_install(kernel, caller, install_id).await?;
        let node = authority_node(&install.scope, WORKSPACE_ROOT_ID);
        let effective = effective_for(kernel, &install, caller.user, node).await?;
        let on_topic = effective.contains(&Capability::GroupTopicSubscribe)
            || effective.contains(&Capability::GroupTopicPublish);
        let usable = install.state == InstallState::Active
            && install.details.topics.iter().any(|t| t == topic)
            && on_topic
            && reaches(kernel, &install, caller.user).await?;
        if !usable {
            return Err(AppsRefusal::Unavailable.into());
        }
        if claim.is_some_and(|k| k.is_empty() || k.len() > MAX_GROUP_KEY_BYTES) {
            return Err(AppsRefusal::Limit("group_key".to_string()).into());
        }
        let root = root_of(&install)?;
        let id = root.namespace_id(&Namespace::Scope);
        let key = topic_key(topic);
        let read = |bytes: Option<Vec<u8>>| bytes.and_then(|b| String::from_utf8(b).ok());
        let _guard = APPS_LOCK.lock().await;
        reread(kernel, &install.id).await?;
        let index = backend.kv_index(&id).await?;
        let recorded = if index.keys.contains_key(&key) {
            read(backend.kv_value(&id, &key_id(&key)).await?)
        } else {
            None
        };
        let group_key = match (recorded, claim) {
            (Some(recorded), _) => Some(recorded),
            (None, None) => None,
            (None, Some(claimed)) => {
                let quota = quota_for(kernel, &install, &Namespace::Scope).await?;
                let next = index
                    .apply(&[(key.as_str(), Some(claimed.len()))], quota)
                    .map_err(|why| match why {
                        StorageRefusal::Limit(what) | StorageRefusal::Policy(what) => {
                            AppsRefusal::Limit(what.to_string())
                        }
                    })?;
                backend
                    .put_kv_value(&id, &key_id(&key), Some(claimed.as_bytes()))
                    .await?;
                backend.save_kv_index(&id, &next).await?;
                let mut ledger = backend.app_ledger(&root).await?;
                ledger.record_namespace(id, next.usage());
                backend.save_app_ledger(&root, &ledger).await?;
                Some(claimed.to_string())
            }
        };
        Ok::<_, Halt>(AppsResponse::TopicGroup {
            install_id: install.id,
            topic: topic.to_string(),
            group_key,
        })
    };
    finish(step.await)
}
