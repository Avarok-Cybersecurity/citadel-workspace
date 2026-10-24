//! An app closing, through the protocol: `WithdrawService` takes its instance's advertisement,
//! and with the session's last one the streams it served, whose callers are sent
//! `Cancel { Closed }`; an uninstall ends the install's relay state the same way.

use super::ihttp_relay_types::RelayFault;
use super::test_ihttp::*;
use super::test_manifests::*;
use super::test_runtime::*;
use citadel_ihttp_types::{CancelReason, IhttpFrameKind};
use citadel_workspace_types::apps::InstallScope;
use citadel_workspace_types::apps_install::AppsRefusal;
use citadel_workspace_types::apps_protocol::AppsRequest;
use citadel_workspace_types::apps_responses::AppsResponse;

const CLOSED: IhttpFrameKind = IhttpFrameKind::Cancel {
    reason: CancelReason::Closed,
};

/// bob serves `id`; alice opens her stream 1 to him. Answers bob's id for it.
async fn served_call(kernel: &super::test_support::Kernel, id: &str) -> u64 {
    assert!(matches!(
        advertise(kernel, "bob", Some(BOB), id).await,
        AppsResponse::Advertised { .. }
    ));
    let mut rx = kernel.subscribe_broadcast();
    let sent = send(
        kernel,
        "alice",
        ALICE,
        id,
        user("bob"),
        head(1, "workspace"),
    )
    .await;
    assert_eq!(sent, AppsResponse::IhttpSent);
    pushed(&mut rx, BOB).2.stream
}

#[tokio::test]
async fn a_withdrawal_ends_the_served_stream_and_tells_the_caller_it_closed() {
    let kernel = workspace_serving(wasm(1, 4096)).await;
    let id = install(&kernel, "boss", InstallScope::Workspace, BOTH).await;
    let served = served_call(&kernel, &id).await;
    let mut rx = kernel.subscribe_broadcast();
    assert_eq!(
        withdraw(&kernel, "bob", Some(BOB), &id, ZONE).await,
        AppsResponse::Withdrawn {
            install_id: id.clone(),
            closed_streams: 1
        }
    );
    let (from, from_cid, cancel) = pushed(&mut rx, ALICE);
    assert_eq!((from.as_str(), from_cid, cancel.stream), ("bob", BOB, 1));
    assert_eq!(cancel.kind, CLOSED);
    // Nothing serves it now, and bob's end of the stream is gone.
    let again = send(
        &kernel,
        "alice",
        ALICE,
        &id,
        user("bob"),
        head(2, "workspace"),
    )
    .await;
    assert_eq!(refusal(&again), Some(&AppsRefusal::NoHost));
    let late = send(
        &kernel,
        "bob",
        BOB,
        &id,
        user("alice"),
        frame(served, IhttpFrameKind::End),
    )
    .await;
    assert_eq!(refusal(&late), Some(&AppsRefusal::Unavailable));
}

#[tokio::test]
async fn another_instance_of_the_session_keeps_serving_after_one_withdraws() {
    let kernel = workspace_serving(wasm(1, 4096)).await;
    let id = install(&kernel, "boss", InstallScope::Workspace, BOTH).await;
    served_call(&kernel, &id).await;
    let second = AppsRequest::AdvertiseService {
        install_id: id.clone(),
        instance: "zone-2".into(),
        routes_digest: served_digest(),
        until_ms: now_ms() + 60_000,
    };
    assert!(matches!(
        ask_on(&kernel, "bob", Some(BOB), second).await,
        AppsResponse::Advertised { .. }
    ));
    let first = withdraw(&kernel, "bob", Some(BOB), &id, ZONE).await;
    assert_eq!(
        first,
        AppsResponse::Withdrawn {
            install_id: id.clone(),
            closed_streams: 0
        }
    );
    let still = send(
        &kernel,
        "alice",
        ALICE,
        &id,
        user("bob"),
        head(2, "workspace"),
    )
    .await;
    assert_eq!(still, AppsResponse::IhttpSent);
}

#[tokio::test]
async fn a_withdrawal_needs_a_session_a_plain_instance_name_and_a_visible_install() {
    let kernel = workspace_serving(wasm(1, 4096)).await;
    let id = install(&kernel, "boss", InstallScope::Workspace, BOTH).await;
    let sessionless = withdraw(&kernel, "bob", None, &id, ZONE).await;
    assert_eq!(refusal(&sessionless), Some(&AppsRefusal::Unavailable));
    let named = withdraw(&kernel, "bob", Some(BOB), &id, "not a name").await;
    assert_eq!(
        refusal(&named),
        Some(&AppsRefusal::Limit("instance".into()))
    );
    let missing = withdraw(&kernel, "bob", Some(BOB), "no-such-install", ZONE).await;
    assert_eq!(refusal(&missing), Some(&AppsRefusal::Unavailable));
    // Control: the same withdrawal, well formed, of an install nobody advertised, ends nothing.
    assert_eq!(
        withdraw(&kernel, "bob", Some(BOB), &id, ZONE).await,
        AppsResponse::Withdrawn {
            install_id: id,
            closed_streams: 0
        }
    );
}

#[tokio::test]
async fn an_uninstall_ends_the_installs_advertisements_and_streams() {
    let kernel = workspace_serving(wasm(1, 4096)).await;
    let id = install(&kernel, "boss", InstallScope::Workspace, BOTH).await;
    let served = served_call(&kernel, &id).await;
    let mut rx = kernel.subscribe_broadcast();
    let uninstall = AppsRequest::Uninstall {
        install_id: id.clone(),
        purge_storage: false,
    };
    assert!(matches!(
        ask_on(&kernel, "boss", None, uninstall).await,
        AppsResponse::Uninstalled { .. }
    ));
    let now = now_ms();
    let mut relay = kernel.apps_relay().lock();
    assert_eq!(
        relay.host(&id, None, now),
        None,
        "the advertisement outlived the install"
    );
    let credit = IhttpFrameKind::Credit { n: 1 };
    let end = relay.from_server(BOB, &id, served, &credit, now);
    assert_eq!(
        end,
        Err(RelayFault::NoStream),
        "bob's end outlived the install"
    );
    drop(relay);
    // Both ends were this install (it calls itself): nobody is left to tell. The other members'
    // notice that the installs changed (apps_notice.rs) is not an end of a stream.
    let told = std::iter::from_fn(|| rx.try_recv().ok()).filter(|m| {
        !matches!(
            m.response,
            crate::WorkspaceProtocolResponse::Apps(AppsResponse::InstallsChanged)
        )
    });
    assert_eq!(told.count(), 0, "an end of the removed install was told");
}
