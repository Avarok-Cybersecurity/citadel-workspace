//! Opening a relayed internal-HTTP stream (R4.4): every check before a `RequestHead` is
//! forwarded. The caller's install may call the target app (`ihttp.call`, its own id or a listed
//! target), the serving install is this app at the frame's scope and Active, the caller is inside
//! its audience and scope, and a session advertised it whose member may still serve it
//! (`ihttp.serve`). A target that fails any of these is the one `NoHost`, so an audience cannot
//! be probed.

use super::apps::{Caller, Step};
use super::apps_gather::effective_for;
use super::apps_ihttp::addressed;
use super::apps_ihttp_end::with_relay;
use super::apps_ihttp_target::{reaches, serving_install};
use crate::kernel::apps::facts::authority_node;
use crate::kernel::apps::ihttp_relay::{Endpoint, Forward};
use crate::kernel::apps::rules::require_capability;
use crate::kernel::async_kernel::AsyncWorkspaceServerKernel;
use crate::WORKSPACE_ROOT_ID;
use citadel_ihttp_types::IhttpFrameKind;
use citadel_sdk::prelude::Ratchet;
use citadel_workspace_types::apps::Capability;
use citadel_workspace_types::apps_install::{AppInstall, AppsRefusal};
use citadel_workspace_types::apps_protocol::IhttpAddress;

/// What `install` may do now for `user`, checked on the install's own authority node.
pub(super) async fn may<R: Ratchet + Send + Sync + 'static>(
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

pub(super) async fn open<R: Ratchet + Send + Sync + 'static>(
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
    if !addressed(&server, to) {
        return Err(AppsRefusal::Unavailable.into());
    }
    let opened = with_relay(kernel, |relay| {
        relay.open(
            client.clone(),
            frame.stream,
            server.clone(),
            *body_len,
            caller.now,
        )
    });
    let id = opened.map_err(super::apps_ihttp::relay_refusal)?;
    Ok(Forward {
        from: client,
        to: server,
        stream: id,
    })
}
