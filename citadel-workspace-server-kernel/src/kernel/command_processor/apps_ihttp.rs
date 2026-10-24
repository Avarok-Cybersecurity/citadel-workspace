//! Internal HTTP through the server (R4.4): `AdvertiseService` and `IhttpSend`.
//!
//! An advertisement names the route table it serves by `routes_digest`
//! (`kernel::apps::ihttp_routes`), and is taken only for the table the installer consented to
//! (the install's `ihttp_routes`).
//!
//! The relay is for callers with no P2P session to the serving host, or addressing a scope.
//! Identity is the session's: the frame a serving app receives carries `from`, stamped here
//! from the caller's session and install, never from the frame. A stream opens with a
//! `RequestHead` only after every check (`apps_ihttp_open`). Later frames follow the stream they
//! belong to, under its flow control (`kernel::apps::ihttp_flow`), and only to the destination
//! they name: a frame addressed elsewhere is refused before the stream's state changes.
//!
//! A session's `RequestHead`s (30/s) and advertisements (2/s) are counted before anything is
//! read for them (`kernel::apps::peer_limiter`), and refused past that as `Limit("ihttp_rate")`.
//! Every relayed frame is metered (`kernel::apps::usage_meter`) against the session that sent it.

use super::apps::{finish, Answer, Caller};
use super::apps_ihttp_end::with_relay;
use super::apps_ihttp_open::{may, open};
use super::apps_member::visible_install;
use crate::kernel::apps::artifact::is_sha256_hex;
use crate::kernel::apps::ihttp_relay::{Endpoint, RelayFault, RELAY_STREAM_BIT};
use crate::kernel::apps::ihttp_routes;
use crate::kernel::apps::usage_meter::Usage;
use crate::kernel::async_kernel::AsyncWorkspaceServerKernel;
use crate::WorkspaceProtocolResponse;
use citadel_ihttp_types::IhttpFrameKind;
use citadel_sdk::prelude::Ratchet;
use citadel_workspace_types::apps::Capability;
use citadel_workspace_types::apps_install::{AppsRefusal, InstallState};
use citadel_workspace_types::apps_protocol::{IhttpAddress, IhttpFrom};
use citadel_workspace_types::apps_responses::AppsResponse;

/// What a session asking past its per-second budget is told.
pub(super) const RATE_REFUSAL: &str = "ihttp_rate";

fn rate_limited() -> AppsRefusal {
    AppsRefusal::Limit(RATE_REFUSAL.to_string())
}

pub(super) fn relay_refusal(fault: RelayFault) -> AppsRefusal {
    match fault {
        RelayFault::NoStream | RelayFault::Misaddressed => AppsRefusal::Unavailable,
        RelayFault::Busy => AppsRefusal::Limit("streams".to_string()),
        RelayFault::AdvertWindow => AppsRefusal::Limit("until_ms".to_string()),
        RelayFault::Instance => AppsRefusal::Limit("instance".to_string()),
        RelayFault::StreamInUse
        | RelayFault::RelayStreamId
        | RelayFault::StreamId
        | RelayFault::Flow(_) => AppsRefusal::Policy,
    }
}

pub(super) async fn advertise<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    caller: &Caller<'_>,
    install_id: &str,
    instance: &str,
    routes_digest: &str,
    until_ms: u64,
) -> Answer {
    let step = async {
        let cid = caller.cid.ok_or(AppsRefusal::Unavailable)?;
        if !kernel
            .apps_relay()
            .lock()
            .adverts_asked
            .admit(cid, caller.now)
        {
            return Err(rate_limited().into());
        }
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
        with_relay(kernel, |relay| {
            relay.advertise(
                &install.id,
                cid,
                caller.user,
                instance,
                until_ms,
                caller.now,
            )
        })
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
        let mut frame = citadel_ihttp_types::decode(bytes).map_err(|_| AppsRefusal::Policy)?;
        let is_head = matches!(frame.kind, IhttpFrameKind::RequestHead { .. });
        if is_head && !kernel.apps_relay().lock().heads.admit(cid, caller.now) {
            return Err(rate_limited().into());
        }
        let (from, _) = visible_install(kernel, caller, from_install_id).await?;
        if matches!(from.state, InstallState::Suspended { .. }) {
            return Err(AppsRefusal::NotActive.into());
        }
        let forward = if is_head {
            open(kernel, caller, cid, &from, to, &frame).await?
        } else {
            let to_named = |end: &Endpoint| addressed(end, to);
            let (stream, kind, now) = (frame.stream, &frame.kind, caller.now);
            let forward = with_relay(kernel, |relay| {
                if stream & RELAY_STREAM_BIT == 0 {
                    relay.from_client(cid, &from.id, stream, kind, to_named, now)
                } else {
                    relay.from_server(cid, &from.id, stream, kind, to_named, now)
                }
            });
            forward.map_err(relay_refusal)?
        };
        kernel.meter(Some(cid), Usage::RelayIhttp, bytes.len() as u64);
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
pub(super) fn addressed(end: &Endpoint, to: &IhttpAddress) -> bool {
    match to {
        IhttpAddress::User { app_id, username } => {
            *app_id == end.app_id && *username == end.username
        }
        IhttpAddress::Scope { app_id, .. } => *app_id == end.app_id,
    }
}
