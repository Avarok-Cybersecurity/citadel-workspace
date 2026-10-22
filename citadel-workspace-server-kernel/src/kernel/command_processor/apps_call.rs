//! `Call`: a host call a running app makes of the workspace server, re-checked here every time.
//!
//! The page's host already refuses an ungranted call, but the page is not trusted: the kernel
//! decides again from what it holds. The install must reach the caller (else `Unavailable`, as
//! for an install that is not there) and not be suspended; then the call's capability must be
//! in what the install may do now for this member on the call's target
//! (`apps_gather::effective_for`: the grant, narrowed to what the installer may still grant and
//! what the member holds there, and nothing outside the install's reach). Anything less is
//! answered with the one `ungranted` reply, whatever the reason, so a call cannot tell an
//! ungranted capability from a demoted installer or a node outside the scope.
//!
//! The server serves the storage backends (`apps_call_storage`) and server egress
//! (`kernel::apps::egress`). Every other group is the page's host's to serve, and is answered
//! `unavailable` here once it passed the check.

use super::apps::{finish, Answer, Caller, Step};
use super::apps_call_storage::serve_storage;
use super::apps_gather::{effective_for, subtree};
use super::apps_member::visible_install;
use crate::kernel::apps::facts::authority_node;
use crate::kernel::async_kernel::AsyncWorkspaceServerKernel;
use crate::WORKSPACE_ROOT_ID;
use citadel_app_sdk_types::calls::{KvBackend, ServerFetch};
use citadel_app_sdk_types::ops::{NetOps, StorageOps};
use citadel_app_sdk_types::{decode, encode, HostCall, HostReply, Refused};
use citadel_sdk::prelude::Ratchet;
use citadel_workspace_types::apps::InstallScope;
use citadel_workspace_types::apps_install::{AppInstall, AppsRefusal, InstallState};
use citadel_workspace_types::apps_responses::AppsResponse;
use serde::Serialize;

/// A reply carrying `value`.
pub(super) fn reply_ok<T: Serialize>(value: T) -> Vec<u8> {
    encode(&HostReply::Ok(value))
}

pub(super) fn reply_refused(refused: Refused) -> Vec<u8> {
    encode(&HostReply::<()>::Refused(refused))
}

pub(super) async fn call<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    caller: &Caller<'_>,
    install_id: &str,
    bytes: &[u8],
) -> Answer {
    let step = async {
        let (install, _) = visible_install(kernel, caller, install_id).await?;
        if matches!(install.state, InstallState::Suspended { .. }) {
            return Err(AppsRefusal::NotActive.into());
        }
        let reply = match decode::<HostCall>(bytes) {
            Ok(call) => serve(kernel, caller, &install, &call).await?,
            Err(_) => reply_refused(Refused::Policy(
                citadel_app_sdk_types::abi::REFUSED_BAD_ARGUMENTS.to_string(),
            )),
        };
        Ok(AppsResponse::CallReply { reply })
    };
    finish(step.await)
}

/// The node `call` acts on, or None when it names one outside the install's reach.
async fn target_of<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    install: &AppInstall,
    call: &HostCall,
) -> Step<Option<String>> {
    let named = match call {
        HostCall::Storage(StorageOps::KvGet(a)) => node_of(&a.backend),
        HostCall::Storage(StorageOps::KvSet(a)) => node_of(&a.backend),
        HostCall::Storage(StorageOps::KvSetMany(a)) => node_of(&a.backend),
        HostCall::Storage(StorageOps::KvDelete(a)) => node_of(&a.backend),
        HostCall::Storage(StorageOps::KvList(a)) => node_of(&a.backend),
        _ => None,
    };
    let authority = authority_node(&install.scope, WORKSPACE_ROOT_ID).to_string();
    let Some(node) = named else {
        return Ok(Some(authority));
    };
    let within = match &install.scope {
        InstallScope::Node(id) => *id == node,
        InstallScope::NodeTree(id) => {
            let nodes = kernel
                .domain_operations
                .backend_tx_manager
                .get_all_nodes_shared()
                .await?;
            subtree(&nodes, id).contains(&node)
        }
        InstallScope::Workspace | InstallScope::Users(_) | InstallScope::SelfOnly(_) => true,
    };
    Ok(within.then_some(node))
}

fn node_of(backend: &KvBackend) -> Option<String> {
    match backend {
        KvBackend::Node { node_id } => Some(node_id.clone()),
        KvBackend::User | KvBackend::Scope | KvBackend::Local => None,
    }
}

async fn serve<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    caller: &Caller<'_>,
    install: &AppInstall,
    call: &HostCall,
) -> Step<Vec<u8>> {
    let Some(target) = target_of(kernel, install, call).await? else {
        return Ok(reply_refused(Refused::Ungranted));
    };
    let effective = effective_for(kernel, install, caller.user, &target).await?;
    if !call.is_granted(|cap| effective.contains(&cap)) {
        return Ok(reply_refused(Refused::Ungranted));
    }
    match call {
        HostCall::Storage(op) => serve_storage(kernel, caller, install, &target, op).await,
        HostCall::Net(NetOps::ServerFetch(fetch)) => {
            server_fetch(kernel, caller, install, fetch).await
        }
        _ => Ok(reply_refused(Refused::Unavailable(
            "workspace_server".to_string(),
        ))),
    }
}

/// The policy reason an egress answer is withheld with when the install that asked for it was
/// removed, or its release replaced, while the request was in flight.
pub(super) const ENDED_IN_FLIGHT: &str = "install_ended";

async fn server_fetch<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    caller: &Caller<'_>,
    install: &AppInstall,
    fetch: &ServerFetch,
) -> Step<Vec<u8>> {
    let Some(egress) = kernel.server_egress() else {
        return Ok(reply_refused(Refused::Unavailable(
            "server_egress".to_string(),
        )));
    };
    let key = (install.id.clone(), caller.user.to_string());
    let hosts = &install.details.server_network_hosts;
    let answer = egress.fetch(&key, hosts, &fetch.request, caller.now).await;
    // A response for an install that ended meanwhile is not delivered to what replaced it.
    let backend = &kernel.domain_operations.backend_tx_manager;
    let now = backend.app_install(&install.id).await?;
    if now.is_none_or(|i| i.manifest_sha256 != install.manifest_sha256) {
        return Ok(reply_refused(Refused::Unavailable(
            ENDED_IN_FLIGHT.to_string(),
        )));
    }
    Ok(match answer {
        Ok(response) => reply_ok(response),
        Err(refused) => reply_refused(refused),
    })
}
