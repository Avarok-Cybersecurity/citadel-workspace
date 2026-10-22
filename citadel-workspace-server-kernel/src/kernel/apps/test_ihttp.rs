//! What the internal-HTTP kernel tests share: two sessions, frames, and reading what the
//! relay pushed.

use super::ihttp_routes::routes_digest;
use super::test_manifests::refused;
use super::test_runtime::*;
use super::test_support::Kernel;
use crate::kernel::async_kernel::BroadcastAudience;
use citadel_ihttp_types::{IhttpFrame, IhttpFrameKind, IhttpMethod};
use citadel_workspace_types::apps::Capability;
use citadel_workspace_types::apps_install::AppsRefusal;
use citadel_workspace_types::apps_protocol::{AppsRequest, IhttpAddress};
use citadel_workspace_types::apps_responses::AppsResponse;
use citadel_workspace_types::WorkspaceProtocolResponse;

pub(crate) const BOTH: &[Capability] = &[Capability::IhttpServe, Capability::IhttpCall];
pub(crate) const ALICE: u64 = 10;
pub(crate) const BOB: u64 = 20;

pub(crate) fn now_ms() -> u64 {
    let since = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH);
    since.expect("clock").as_millis() as u64
}

pub(crate) fn head(stream: u64, scope_key: &str) -> Vec<u8> {
    let kind = IhttpFrameKind::RequestHead {
        method: IhttpMethod::Get,
        path: "/cards".into(),
        query: None,
        headers: vec![],
        body_len: Some(0),
        app_id: APP_ID.into(),
        scope_key: scope_key.into(),
    };
    citadel_ihttp_types::encode(&IhttpFrame { v: 1, stream, kind }).expect("frame")
}

pub(crate) fn frame(stream: u64, kind: IhttpFrameKind) -> Vec<u8> {
    citadel_ihttp_types::encode(&IhttpFrame { v: 1, stream, kind }).expect("frame")
}

pub(crate) fn user(username: &str) -> IhttpAddress {
    IhttpAddress::User {
        app_id: APP_ID.into(),
        username: username.into(),
    }
}

/// The digest of the test manifest's `ihttp.serve` routes (`test_runtime`).
pub(crate) fn served_digest() -> String {
    routes_digest(["GET /cards"])
}

pub(crate) async fn advertise(
    kernel: &Kernel,
    who: &str,
    cid: Option<u64>,
    install_id: &str,
) -> AppsResponse {
    advertise_digest(kernel, who, cid, install_id, &served_digest()).await
}

pub(crate) async fn advertise_digest(
    kernel: &Kernel,
    who: &str,
    cid: Option<u64>,
    install_id: &str,
    routes_digest: &str,
) -> AppsResponse {
    let request = AppsRequest::AdvertiseService {
        install_id: install_id.into(),
        instance: ZONE.into(),
        routes_digest: routes_digest.into(),
        until_ms: now_ms() + 60_000,
    };
    ask_on(kernel, who, cid, request).await
}

/// The instance every test host advertises from.
pub(crate) const ZONE: &str = "zone-1";

/// `instance` of `who`'s session (`cid`) withdraws `install_id`.
pub(crate) async fn withdraw(
    kernel: &Kernel,
    who: &str,
    cid: Option<u64>,
    install_id: &str,
    instance: &str,
) -> AppsResponse {
    let request = AppsRequest::WithdrawService {
        install_id: install_id.into(),
        instance: instance.into(),
    };
    ask_on(kernel, who, cid, request).await
}

pub(crate) async fn send(
    kernel: &Kernel,
    who: &str,
    cid: u64,
    from: &str,
    to: IhttpAddress,
    bytes: Vec<u8>,
) -> AppsResponse {
    let request = AppsRequest::IhttpSend {
        from_install_id: from.into(),
        to,
        frame: bytes,
    };
    ask_on(kernel, who, Some(cid), request).await
}

/// The frame pushed to the session `cid`: who sent it, and the frame.
pub(crate) fn pushed(
    rx: &mut tokio::sync::broadcast::Receiver<crate::kernel::async_kernel::BroadcastMessage>,
    cid: u64,
) -> (String, u64, IhttpFrame) {
    let message = rx.try_recv().expect("a frame was pushed");
    assert_eq!(message.audience, BroadcastAudience::Session(cid));
    let WorkspaceProtocolResponse::Apps(AppsResponse::IhttpFrame { from, frame, .. }) =
        message.response
    else {
        panic!("not a frame: {:?}", message.response);
    };
    let frame = citadel_ihttp_types::decode(&frame).expect("frame");
    (from.username, from.cid, frame)
}

pub(crate) fn refusal(answer: &AppsResponse) -> Option<&AppsRefusal> {
    refused(answer)
}
