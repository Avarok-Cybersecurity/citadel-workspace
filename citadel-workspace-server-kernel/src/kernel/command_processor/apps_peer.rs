//! A member's own peer settings for an install (`SetPeerConsentForMe`, `SetPeerBlockedForMe`)
//! and the serving or calling host's question `AuthorizePeer` (design §1, check #5).
//!
//! `AuthorizePeer` asks about the asking session and the session `peer_cid`, never about a name
//! the page supplies: the kernel maps the CID to its account itself. Every reason to refuse is
//! the one `NoHost` (an audience, a consent or a block list cannot be probed), except the
//! per-session question budget, which says `Limit`.

use super::apps::{finish, Answer, Caller, Halt, Step};
use super::apps_gather::effective_for;
use super::apps_ihttp_target::reaches;
use super::apps_member::visible_install;
use crate::kernel::apps::facts::authority_node;
use crate::kernel::apps::ihttp_routes::routes_digest;
use crate::kernel::apps::peer_rules::{authorized, PeerQuestion, Side};
use crate::kernel::apps::records::PeerSettings;
use crate::kernel::async_kernel::AsyncWorkspaceServerKernel;
use crate::kernel::transaction::apps_store::APPS_LOCK;
use crate::WORKSPACE_ROOT_ID;
use citadel_sdk::prelude::Ratchet;
use citadel_workspace_types::apps::peer::{
    PeerConsent, PeerDirection, MAX_BLOCKED_PEERS, PEER_AUTHORIZATION_TTL_MS,
};
use citadel_workspace_types::apps_install::{AppInstall, AppsRefusal, InstallState};
use citadel_workspace_types::apps_protocol::IhttpFrom;
use citadel_workspace_types::apps_responses::AppsResponse;

/// The install `id`, if it reaches the caller: a member sets peer settings only for installs
/// that apply to them.
async fn reaching_install<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    caller: &Caller<'_>,
    id: &str,
) -> Step<AppInstall> {
    let (install, _) = visible_install(kernel, caller, id).await?;
    if !reaches(kernel, &install, caller.user).await? {
        return Err(AppsRefusal::Unavailable.into());
    }
    Ok(install)
}

/// Change the caller's settings for `install_id` with `f`, under the apps lock.
async fn update_mine<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    caller: &Caller<'_>,
    install_id: &str,
    f: impl FnOnce(&mut PeerSettings) -> Result<(), AppsRefusal>,
) -> Step<PeerSettings> {
    let backend = &kernel.domain_operations.backend_tx_manager;
    let _guard = APPS_LOCK.lock().await;
    let mut mine = backend.user_apps(caller.user).await?;
    let settings = mine
        .peer
        .entry(install_id.to_string())
        .or_insert(PeerSettings {
            consent: PeerConsent::NONE,
            blocked: Default::default(),
        });
    f(settings)?;
    let settings = settings.clone();
    backend.save_user_apps(caller.user, &mine).await?;
    Ok(settings)
}

pub(super) async fn set_consent<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    caller: &Caller<'_>,
    install_id: &str,
    (serve, call, topics): (bool, bool, bool),
) -> Answer {
    let step = async {
        let install = reaching_install(kernel, caller, install_id).await?;
        let consent = PeerConsent {
            serve,
            call,
            topics,
            at_ms: caller.now,
        };
        update_mine(kernel, caller, &install.id, |s| {
            s.consent = consent;
            Ok(())
        })
        .await?;
        Ok::<_, Halt>(AppsResponse::PeerConsentForMe {
            install_id: install.id,
            consent,
        })
    };
    finish(step.await)
}

pub(super) async fn set_blocked<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    caller: &Caller<'_>,
    install_id: &str,
    username: &str,
    blocked: bool,
) -> Answer {
    let step = async {
        let install = reaching_install(kernel, caller, install_id).await?;
        if username.is_empty() || username == caller.user {
            return Err(AppsRefusal::Policy.into());
        }
        update_mine(kernel, caller, &install.id, |s| {
            if !blocked {
                s.blocked.remove(username);
            } else if s.blocked.len() >= MAX_BLOCKED_PEERS {
                return Err(AppsRefusal::Limit("blocked".to_string()));
            } else {
                s.blocked.insert(username.to_string());
            }
            Ok(())
        })
        .await?;
        Ok::<_, Halt>(AppsResponse::PeerBlockedForMe {
            install_id: install.id,
            username: username.to_string(),
            blocked,
        })
    };
    finish(step.await)
}

/// One end, as the kernel finds it now.
async fn side<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    install: &AppInstall,
    username: &str,
) -> Step<Side> {
    let node = authority_node(&install.scope, WORKSPACE_ROOT_ID);
    let mine = kernel
        .domain_operations
        .backend_tx_manager
        .user_apps(username)
        .await?;
    Ok(Side {
        username: username.to_string(),
        reached: reaches(kernel, install, username).await?,
        effective: effective_for(kernel, install, username, node).await?,
        blocked: mine.blocked(&install.id),
    })
}

pub(super) async fn authorize<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    caller: &Caller<'_>,
    install_id: &str,
    peer_cid: u64,
    direction: &PeerDirection,
) -> Answer {
    let step = async {
        let cid = caller.cid.ok_or(AppsRefusal::NoHost)?;
        if !kernel
            .apps_relay()
            .lock()
            .peer_checks
            .admit(cid, caller.now)
        {
            return Err(AppsRefusal::Limit("peer_checks".to_string()).into());
        }
        let backend = &kernel.domain_operations.backend_tx_manager;
        let install = backend
            .app_install(install_id)
            .await?
            .ok_or(AppsRefusal::NoHost)?;
        let peer_user = kernel
            .connected_users
            .account_of(peer_cid)
            .ok_or(AppsRefusal::NoHost)?;
        let question = PeerQuestion {
            active: install.state == InstallState::Active,
            asker: side(kernel, &install, caller.user).await?,
            peer: side(kernel, &install, &peer_user).await?,
            p2p_routes_digest: routes_digest(
                install.details.ihttp_p2p_routes.iter().map(String::as_str),
            ),
            topics: install.details.topics.clone(),
        };
        if !authorized(&question, direction) {
            return Err(AppsRefusal::NoHost.into());
        }
        Ok::<_, Halt>(AppsResponse::PeerAuthorized {
            install_id: install.id.clone(),
            peer: IhttpFrom {
                username: peer_user,
                cid: peer_cid,
                app_id: install.app_id.clone(),
                install_id: install.id,
            },
            direction: direction.clone(),
            until_ms: caller.now + PEER_AUTHORIZATION_TTL_MS,
        })
    };
    finish(step.await)
}
