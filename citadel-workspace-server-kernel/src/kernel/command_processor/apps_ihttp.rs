//! Internal HTTP through the server (R4.4): `AdvertiseService` and `IhttpSend`.
//!
//! An advertisement names the route table it serves by `routes_digest`
//! (`kernel::apps::ihttp_routes`), and is taken only for the table the installer consented to
//! (the install's `ihttp_routes`).
//!
//! The relay is for callers with no P2P session to the serving host, or addressing a scope.
//! Identity is the session's: the frame a serving app receives carries `from`, stamped here
//! from the caller's session and install, never from the frame. A stream opens with a
//! `RequestHead` only after every check: the caller's install may call the target app
//! (`ihttp.call`, its own id or a listed target), the serving install is this app at the frame's
//! scope and Active, the caller is inside its audience and scope, and a session advertised it
//! whose member may still serve it (`ihttp.serve`). A target that fails any of these is the one
//! `NoHost`, so an audience cannot be probed. Later frames follow the stream they belong to,
//! under its flow control (`kernel::apps::ihttp_flow`).

use super::apps::{finish, Answer, Caller, Step};
use super::apps_gather::effective_for;
use super::apps_ihttp_target::{reaches, serving_install};
use super::apps_member::visible_install;
use crate::kernel::apps::artifact::is_sha256_hex;
use crate::kernel::apps::facts::authority_node;
use crate::kernel::apps::ihttp_relay::{Endpoint, Forward, RelayFault, RELAY_STREAM_BIT};
use crate::kernel::apps::ihttp_routes;
use crate::kernel::apps::rules::require_capability;
use crate::kernel::async_kernel::AsyncWorkspaceServerKernel;
use crate::{WorkspaceProtocolResponse, WORKSPACE_ROOT_ID};
use citadel_ihttp_types::IhttpFrameKind;
use citadel_sdk::prelude::Ratchet;
use citadel_workspace_types::apps::Capability;
use citadel_workspace_types::apps_install::{AppInstall, AppsRefusal, InstallState};
use citadel_workspace_types::apps_protocol::{IhttpAddress, IhttpFrom};
use citadel_workspace_types::apps_responses::AppsResponse;

fn relay_refusal(fault: RelayFault) -> AppsRefusal {
    match fault {
        RelayFault::NoStream => AppsRefusal::Unavailable,
        RelayFault::Busy => AppsRefusal::Limit("streams".to_string()),
        RelayFault::AdvertWindow => AppsRefusal::Limit("until_ms".to_string()),
        RelayFault::StreamInUse | RelayFault::RelayStreamId | RelayFault::Flow(_) => {
            AppsRefusal::Policy
        }
    }
}

/// What `install` may do now for `user`, checked on the install's own authority node.
async fn may<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    install: &AppInstall,
    user: &str,
    cap: Capability,
) -> Step<bool> {
    let node = authority_node(&install.scope, WORKSPACE_ROOT_ID);
    Ok(effective_for(kernel, install, user, node)
        .await?
        .contains(&cap))
}

pub(super) async fn advertise<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    caller: &Caller<'_>,
    install_id: &str,
    routes_digest: &str,
    until_ms: u64,
) -> Answer {
    let step = async {
        let cid = caller.cid.ok_or(AppsRefusal::Unavailable)?;
        let (install, _) = visible_install(kernel, caller, install_id).await?;
        if install.state != InstallState::Active {
            return Err(AppsRefusal::NotActive.into());
        }
        if !is_sha256_hex(routes_digest) {
            return Err(AppsRefusal::Limit("routes_digest".to_string()).into());
        }
        if !may(kernel, &install, caller.user, Capability::IhttpServe).await? {
            return Err(AppsRefusal::Ungranted(Capability::IhttpServe).into());
        }
        let consented = &install.details.ihttp_routes;
        if ihttp_routes::routes_digest(consented.iter().map(String::as_str)) != routes_digest {
            return Err(AppsRefusal::Policy.into());
        }
        kernel
            .apps_relay()
            .lock()
            .advertise(&install.id, cid, caller.user, until_ms, caller.now)
            .map_err(relay_refusal)?;
        Ok(AppsResponse::Advertised { until_ms })
    };
    finish(step.await)
}

pub(super) async fn send<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    caller: &Caller<'_>,
    from_install_id: &str,
    to: &IhttpAddress,
    bytes: &[u8],
) -> Answer {
    let step = async {
        let cid = caller.cid.ok_or(AppsRefusal::Unavailable)?;
        let (from, _) = visible_install(kernel, caller, from_install_id).await?;
        if matches!(from.state, InstallState::Suspended { .. }) {
            return Err(AppsRefusal::NotActive.into());
        }
        let mut frame = citadel_ihttp_types::decode(bytes).map_err(|_| AppsRefusal::Policy)?;
        let forward = if let IhttpFrameKind::RequestHead { .. } = &frame.kind {
            open(kernel, caller, cid, &from, to, &frame).await?
        } else {
            let mut relay = kernel.apps_relay().lock();
            let forward = if frame.stream & RELAY_STREAM_BIT == 0 {
                relay.from_client(cid, &from.id, frame.stream, &frame.kind, caller.now)
            } else {
                relay.from_server(cid, &from.id, frame.stream, &frame.kind, caller.now)
            };
            forward.map_err(relay_refusal)?
        };
        if !addressed(&forward, to) {
            return Err(AppsRefusal::Unavailable.into());
        }
        frame.stream = forward.stream;
        let frame = citadel_ihttp_types::encode(&frame).map_err(|_| AppsRefusal::Policy)?;
        let pushed = AppsResponse::IhttpFrame {
            from: IhttpFrom {
                username: forward.from.username,
                cid: forward.from.cid,
                app_id: forward.from.app_id,
                install_id: forward.from.install_id,
            },
            to_install_id: forward.to.install_id,
            frame,
        };
        kernel.send_to_session(WorkspaceProtocolResponse::Apps(pushed), forward.to.cid);
        Ok(AppsResponse::IhttpSent)
    };
    finish(step.await)
}

/// Whether `to` names where the stream goes: the app, and the member (or the scope) serving it.
fn addressed(forward: &Forward, to: &IhttpAddress) -> bool {
    match to {
        IhttpAddress::User { app_id, username } => {
            *app_id == forward.to.app_id && *username == forward.to.username
        }
        IhttpAddress::Scope { app_id, .. } => *app_id == forward.to.app_id,
    }
}

async fn open<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    caller: &Caller<'_>,
    cid: u64,
    from: &AppInstall,
    to: &IhttpAddress,
    frame: &citadel_ihttp_types::IhttpFrame,
) -> Step<Forward> {
    let IhttpFrameKind::RequestHead {
        app_id,
        scope_key,
        body_len,
        ..
    } = &frame.kind
    else {
        return Err(AppsRefusal::Policy.into());
    };
    let (target_app, username) = match to {
        IhttpAddress::User { app_id, username } => (app_id, Some(username.as_str())),
        IhttpAddress::Scope {
            app_id,
            scope_key: addressed,
        } => {
            if addressed != scope_key {
                return Err(AppsRefusal::Policy.into());
            }
            (app_id, None)
        }
    };
    let listed = *target_app == from.app_id || from.details.ihttp_call_targets.contains(target_app);
    let effective = effective_for(
        kernel,
        from,
        caller.user,
        authority_node(&from.scope, WORKSPACE_ROOT_ID),
    )
    .await?;
    require_capability(&effective, Capability::IhttpCall)?;
    if !listed {
        return Err(AppsRefusal::Ungranted(Capability::IhttpCall).into());
    }
    if app_id != target_app {
        return Err(AppsRefusal::Policy.into());
    }
    let serving = serving_install(kernel, target_app, scope_key).await?;
    if !reaches(kernel, &serving, caller.user).await? {
        return Err(AppsRefusal::NoHost.into());
    }
    let host = kernel
        .apps_relay()
        .lock()
        .host(&serving.id, username, caller.now);
    let (server_cid, server_user) = host.ok_or(AppsRefusal::NoHost)?;
    if !may(kernel, &serving, &server_user, Capability::IhttpServe).await? {
        return Err(AppsRefusal::NoHost.into());
    }
    let client = Endpoint {
        cid,
        username: caller.user.to_string(),
        install_id: from.id.clone(),
        app_id: from.app_id.clone(),
    };
    let server = Endpoint {
        cid: server_cid,
        username: server_user,
        install_id: serving.id.clone(),
        app_id: serving.app_id.clone(),
    };
    let mut relay = kernel.apps_relay().lock();
    let id = relay
        .open(
            client.clone(),
            frame.stream,
            server.clone(),
            *body_len,
            caller.now,
        )
        .map_err(relay_refusal)?;
    Ok(Forward {
        from: client,
        to: server,
        stream: id,
    })
}
