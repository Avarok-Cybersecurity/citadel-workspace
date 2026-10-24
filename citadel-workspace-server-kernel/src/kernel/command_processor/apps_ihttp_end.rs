//! Ending relayed internal HTTP (R4.4): `WithdrawService`, from an instance whose app closed,
//! and the end of an install's relay state when its release stops being the one that runs
//! (uninstall, rollback, an update taking effect). The surviving end of every stream that closed
//! is sent `Cancel { Closed }` at once, as the relay would forward a cancel, rather than left to
//! wait out the stream's deadline.
//!
//! Every use of the relay goes through `with_relay`, which settles what the relay recorded: an
//! `[APPS-IHTTP]` audit line per stream opened or closed (`kernel::apps::ihttp_audit`), and
//! `Cancel { Timeout }` to both ends of every stream whose deadline passed.

use super::apps::{finish, Answer, Caller};
use super::apps_member::visible_install;
use crate::kernel::apps::ihttp_adverts::is_instance_name;
use crate::kernel::apps::ihttp_audit::audit_line;
use crate::kernel::apps::ihttp_relay::{
    CloseReason, Forward, IhttpRelay, RelayHandle, RelayRecord,
};
use crate::kernel::async_kernel::AsyncWorkspaceServerKernel;
use crate::WorkspaceProtocolResponse;
use citadel_ihttp_types::{CancelReason, IhttpFrame, IhttpFrameKind, IHTTP_VERSION};
use citadel_logging::{info, warn};
use citadel_sdk::prelude::Ratchet;
use citadel_workspace_types::apps_install::AppsRefusal;
use citadel_workspace_types::apps_protocol::IhttpFrom;
use citadel_workspace_types::apps_responses::AppsResponse;

pub(super) async fn withdraw<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    caller: &Caller<'_>,
    install_id: &str,
    instance: &str,
) -> Answer {
    let step = async {
        let cid = caller.cid.ok_or(AppsRefusal::Unavailable)?;
        if !is_instance_name(instance) {
            return Err(AppsRefusal::Limit("instance".to_string()).into());
        }
        // An install the caller cannot see is `Unavailable`, as for every other request.
        let (install, _) = visible_install(kernel, caller, install_id).await?;
        let ended = with_relay(kernel, |relay| {
            relay.withdraw(&install.id, cid, instance, caller.now)
        });
        let closed_streams = u32::try_from(ended.closed).unwrap_or(u32::MAX);
        tell(kernel, ended.tell, CancelReason::Closed);
        Ok(AppsResponse::Withdrawn {
            install_id: install.id,
            closed_streams,
        })
    };
    finish(step.await)
}

/// `install_id`'s release no longer runs: its advertisements and relayed streams end.
pub(super) fn end_install_relay<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    install_id: &str,
    now_ms: u64,
) {
    let ended = with_relay(kernel, |relay| relay.forget_install(install_id, now_ms));
    tell(kernel, ended.tell, CancelReason::Closed);
}

/// The session `cid` ended (its connection's relay handle dropped): its advertisements and
/// streams end, with their audit lines. Nobody can be told from here. Answers how many closed.
pub(crate) fn end_session_relay(relay: &RelayHandle, cid: u64) -> usize {
    let (closed, records) = {
        let mut relay = relay.lock();
        (relay.forget_session(cid), relay.take_records())
    };
    records
        .iter()
        .for_each(|record| info!(target: "citadel", "{}", audit_line(record)));
    closed
}

/// Runs `use_relay` on the kernel's relay, then settles what it recorded, with the lock released.
pub(crate) fn with_relay<R: Ratchet + Send + Sync + 'static, T>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    use_relay: impl FnOnce(&mut IhttpRelay) -> T,
) -> T {
    let (answer, records) = {
        let mut relay = kernel.apps_relay().lock();
        let answer = use_relay(&mut relay);
        (answer, relay.take_records())
    };
    settle(kernel, records);
    answer
}

fn settle<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    records: Vec<RelayRecord>,
) {
    let mut timed_out = Vec::new();
    for record in records {
        info!(target: "citadel", "{}", audit_line(&record));
        if record.closed == Some(CloseReason::Timeout) {
            timed_out.push(Forward {
                from: record.server.clone(),
                to: record.client.clone(),
                stream: record.client_stream,
            });
            timed_out.push(Forward {
                from: record.client,
                to: record.server,
                stream: record.stream,
            });
        }
    }
    tell(kernel, timed_out, CancelReason::Timeout);
}

/// Sends each end in `ends` `Cancel { reason }` on the id it knows its stream by.
fn tell<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    ends: Vec<Forward>,
    reason: CancelReason,
) {
    for forward in ends {
        let cancel = IhttpFrame {
            v: IHTTP_VERSION,
            stream: forward.stream,
            kind: IhttpFrameKind::Cancel { reason },
        };
        let frame = match citadel_ihttp_types::encode(&cancel) {
            Ok(frame) => frame,
            Err(e) => {
                warn!(target: "citadel", "[APPS] A closing cancel did not encode: {e:?}");
                continue;
            }
        };
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
    }
}
