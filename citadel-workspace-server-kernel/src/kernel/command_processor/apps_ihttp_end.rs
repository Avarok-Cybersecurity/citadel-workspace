//! Ending relayed internal HTTP (R4.4): `WithdrawService`, from an instance whose app closed,
//! and the end of an install's relay state when its release stops being the one that runs
//! (uninstall, rollback, an update taking effect). The surviving end of every stream that closed
//! is sent `Cancel { Closed }` at once, as the relay would forward a cancel, rather than left to
//! wait out the stream's deadline.

use super::apps::{finish, Answer, Caller};
use super::apps_member::visible_install;
use crate::kernel::apps::ihttp_adverts::is_instance_name;
use crate::kernel::apps::ihttp_relay_end::Ended;
use crate::kernel::async_kernel::AsyncWorkspaceServerKernel;
use crate::WorkspaceProtocolResponse;
use citadel_ihttp_types::{CancelReason, IhttpFrame, IhttpFrameKind, IHTTP_VERSION};
use citadel_logging::warn;
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
        let ended = kernel
            .apps_relay()
            .lock()
            .withdraw(&install.id, cid, instance);
        let closed_streams = u32::try_from(ended.closed).unwrap_or(u32::MAX);
        tell_closed(kernel, ended);
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
) {
    let ended = kernel.apps_relay().lock().forget_install(install_id);
    tell_closed(kernel, ended);
}

fn tell_closed<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    ended: Ended,
) {
    for forward in ended.tell {
        let cancel = IhttpFrame {
            v: IHTTP_VERSION,
            stream: forward.stream,
            kind: IhttpFrameKind::Cancel {
                reason: CancelReason::Closed,
            },
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
