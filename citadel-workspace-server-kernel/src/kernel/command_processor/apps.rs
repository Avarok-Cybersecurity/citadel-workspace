//! `Apps` requests: gather the facts, ask `kernel::apps`, write the result.
//!
//! - Listings: `ListCatalogue` and `GetListing` (`apps_listing`) answer this workspace's registry
//!   entries whose audience admits the caller; the global catalogue is a signed file the UI
//!   loads itself. A listing the caller may not see is `Unavailable`, as a missing one is.
//!   `Publish` needs `AppPublish`, `UploadArtifactChunk` one of `AppPublish`, `AppInstall` or
//!   `AppInstallScoped`.
//! - Installs: `Install` (`apps_install`) needs `AppInstall` for oneself, or `AppInstallScoped`
//!   and `UpdateNodeSettings` on the scope's node for anyone else, and each granted capability's
//!   `AppInstallAllow*` there; writing the document header takes `AppManage` and `EditMdx`.
//!   `Uninstall`, `Update`, `Consent` (`apps_lifecycle`) take the installer or `AppManage`;
//!   `Rollback` and `ListAudit` take `AppManage`.
//! - A member's own: `ListInstalls`, `SetDisabledForMe`, `GetRelease`, `FetchArtifact`
//!   (`apps_member`) answer for installs that reach the caller, that they made, or any install
//!   to an `AppManage` holder; anything else is `Unavailable`.
//! - The app runtime's server side: `Call` (`apps_call`) re-checks the call's capability and
//!   serves the storage backends and server egress; `AdvertiseService` and `IhttpSend`
//!   (`apps_ihttp`) relay internal HTTP between members' sessions, and `WithdrawService`
//!   (`apps_ihttp_end`) ends what an instance served when its app closed.
//! - `RequestInstall` is copy-link only in this release.

use super::apps_call::call;
use super::apps_ihttp::{advertise, send};
use super::apps_ihttp_end::withdraw;
use super::apps_install::install;
use super::apps_lifecycle::{rollback, uninstall};
use super::apps_listing::{get_listing, list_catalogue, publish};
use super::apps_member::{fetch_artifact, get_release, list_audit, list_installs, set_disabled};
use super::apps_notice::notice_for;
use super::apps_peer::{authorize, set_blocked, set_consent};
use super::apps_peer_topic::topic_group;
use super::apps_update::{consent, update};
use super::apps_upload::upload_chunk;
use super::telemetry::now_ms;
use crate::kernel::async_kernel::AsyncWorkspaceServerKernel;
use crate::WorkspaceProtocolResponse;
use citadel_sdk::prelude::{NetworkError, Ratchet};
use citadel_workspace_types::apps_install::AppsRefusal;
use citadel_workspace_types::apps_protocol::AppsRequest;
use citadel_workspace_types::apps_responses::{AppsAuditEntry, AppsAuditEvent, AppsResponse};

pub(super) type Answer = Result<WorkspaceProtocolResponse, NetworkError>;

pub(super) fn answer(response: AppsResponse) -> Answer {
    Ok(WorkspaceProtocolResponse::Apps(response))
}

pub(super) fn refuse(refusal: AppsRefusal) -> Answer {
    answer(AppsResponse::Refused(refusal))
}

/// An audit entry by `actor` about `app_id` at `now`.
pub(super) fn audit_entry(
    now: u64,
    actor: &str,
    app_id: &str,
    install_id: Option<&str>,
    event: AppsAuditEvent,
) -> AppsAuditEntry {
    AppsAuditEntry {
        at_ms: now,
        actor: actor.to_string(),
        app_id: app_id.to_string(),
        install_id: install_id.map(str::to_string),
        event,
    }
}

/// Why a handler stopped: a refusal the caller is told, or a failure of the server's own.
pub(super) enum Halt {
    Refused(AppsRefusal),
    Failed(NetworkError),
}

impl From<NetworkError> for Halt {
    fn from(e: NetworkError) -> Self {
        Self::Failed(e)
    }
}

impl From<AppsRefusal> for Halt {
    fn from(refusal: AppsRefusal) -> Self {
        Self::Refused(refusal)
    }
}

pub(super) type Step<T> = Result<T, Halt>;

/// A handler's outcome as the protocol answers it.
pub(super) fn finish(step: Step<AppsResponse>) -> Answer {
    match step {
        Ok(response) => answer(response),
        Err(Halt::Refused(refusal)) => refuse(refusal),
        Err(Halt::Failed(e)) => Err(e),
    }
}

/// A request, as the handlers see it: who asks, and when.
pub(super) struct Caller<'a> {
    pub user: &'a str,
    pub cid: Option<u64>,
    pub now: u64,
}

/// One apps request, answered; when the answer changed what the workspace's other members hold,
/// they are told so (apps_notice.rs).
pub(super) async fn process<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    actor_user_id: &str,
    requester_cid: Option<u64>,
    request: &AppsRequest,
) -> Answer {
    let answered = respond(kernel, actor_user_id, requester_cid, request).await;
    if let Ok(WorkspaceProtocolResponse::Apps(response)) = &answered {
        if let Some(notice) = notice_for(response) {
            kernel.broadcast_to_workspace(
                WorkspaceProtocolResponse::Apps(notice),
                requester_cid,
                crate::WORKSPACE_ROOT_ID.to_string(),
            );
        }
    }
    answered
}

async fn respond<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    actor_user_id: &str,
    requester_cid: Option<u64>,
    request: &AppsRequest,
) -> Answer {
    let caller = Caller {
        user: actor_user_id,
        cid: requester_cid,
        now: now_ms()?,
    };
    match request {
        AppsRequest::ListCatalogue => list_catalogue(kernel, &caller).await,
        AppsRequest::GetListing { app_id } => get_listing(kernel, &caller, app_id).await,
        AppsRequest::ListInstalls => list_installs(kernel, &caller).await,
        AppsRequest::Publish {
            manifest_bytes,
            signature,
        } => publish(kernel, &caller, manifest_bytes, signature).await,
        AppsRequest::UploadArtifactChunk {
            sha256,
            index,
            total_chunks,
            bytes,
        } => upload_chunk(kernel, &caller, sha256, *index, *total_chunks, bytes).await,
        AppsRequest::Install { .. } => install(kernel, &caller, request).await,
        AppsRequest::Uninstall {
            install_id,
            purge_storage,
        } => uninstall(kernel, &caller, install_id, *purge_storage).await,
        AppsRequest::Update {
            install_id,
            listing,
        } => update(kernel, &caller, install_id, listing).await,
        AppsRequest::Rollback { install_id } => rollback(kernel, &caller, install_id).await,
        AppsRequest::Consent { .. } => consent(kernel, &caller, request).await,
        AppsRequest::SetDisabledForMe {
            install_id,
            disabled,
        } => set_disabled(kernel, &caller, install_id, *disabled).await,
        AppsRequest::SetPeerConsentForMe {
            install_id,
            serve,
            call,
            topics,
        } => set_consent(kernel, &caller, install_id, (*serve, *call, *topics)).await,
        AppsRequest::SetPeerBlockedForMe {
            install_id,
            username,
            blocked,
        } => set_blocked(kernel, &caller, install_id, username, *blocked).await,
        AppsRequest::AuthorizePeer {
            install_id,
            peer_cid,
            direction,
        } => authorize(kernel, &caller, install_id, *peer_cid, direction).await,
        AppsRequest::TopicGroup {
            install_id,
            topic,
            claim,
        } => topic_group(kernel, &caller, install_id, topic, claim.as_deref()).await,
        AppsRequest::FetchArtifact { sha256, index } => {
            fetch_artifact(kernel, &caller, sha256, *index).await
        }
        AppsRequest::GetRelease { install_id } => get_release(kernel, &caller, install_id).await,
        AppsRequest::ListAudit { before_ms } => list_audit(kernel, &caller, *before_ms).await,
        AppsRequest::RequestInstall { .. } => refuse(AppsRefusal::InstallRequestsNotOffered),
        AppsRequest::Call {
            install_id,
            call: bytes,
        } => call(kernel, &caller, install_id, bytes).await,
        AppsRequest::AdvertiseService {
            install_id,
            instance,
            routes_digest,
            until_ms,
        } => {
            advertise(
                kernel,
                &caller,
                install_id,
                instance,
                routes_digest,
                *until_ms,
            )
            .await
        }
        AppsRequest::WithdrawService {
            install_id,
            instance,
        } => withdraw(kernel, &caller, install_id, instance).await,
        AppsRequest::IhttpSend {
            from_install_id,
            to,
            frame,
        } => send(kernel, &caller, from_install_id, to, frame).await,
    }
}
