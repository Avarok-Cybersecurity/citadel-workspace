//! Internal HTTP relayed through the kernel: only advertised installs are reachable, every
//! check before a stream opens, the caller stamped by the server, and frames routed back.

use super::ihttp_relay::RELAY_STREAM_BIT;
use super::test_ihttp::*;
use super::test_manifests::*;
use super::test_runtime::*;
use citadel_ihttp_types::IhttpFrameKind;
use citadel_workspace_types::apps::{Capability, InstallScope};
use citadel_workspace_types::apps_install::AppsRefusal;
use citadel_workspace_types::apps_protocol::IhttpAddress;
use citadel_workspace_types::apps_responses::AppsResponse;

#[tokio::test]
async fn a_request_reaches_the_advertising_session_and_the_answer_comes_back() {
    let kernel = workspace_serving(wasm(1, 4096)).await;
    let id = install(&kernel, "boss", InstallScope::Workspace, BOTH).await;
    assert!(matches!(
        advertise(&kernel, "bob", Some(BOB), &id).await,
        AppsResponse::Advertised { .. }
    ));
    let mut rx = kernel.subscribe_broadcast();
    let sent = send(
        &kernel,
        "alice",
        ALICE,
        &id,
        user("bob"),
        head(1, "workspace"),
    )
    .await;
    assert_eq!(sent, AppsResponse::IhttpSent);
    let (from, from_cid, request) = pushed(&mut rx, BOB);
    assert_eq!((from.as_str(), from_cid), ("alice", ALICE));
    assert_ne!(request.stream & RELAY_STREAM_BIT, 0);
    let answer = IhttpFrameKind::ResponseHead {
        status: 200,
        headers: vec![],
        body_len: Some(0),
    };
    let back = send(
        &kernel,
        "bob",
        BOB,
        &id,
        user("alice"),
        frame(request.stream, answer),
    )
    .await;
    assert_eq!(back, AppsResponse::IhttpSent);
    let (from, _, response) = pushed(&mut rx, ALICE);
    assert_eq!((from.as_str(), response.stream), ("bob", 1));
    // A later frame that names another destination than its stream's is refused.
    let forged = send(
        &kernel,
        "alice",
        ALICE,
        &id,
        user("carol"),
        frame(1, IhttpFrameKind::End),
    )
    .await;
    assert_eq!(refusal(&forged), Some(&AppsRefusal::Unavailable));
}

#[tokio::test]
async fn an_install_nobody_advertised_is_unreachable() {
    let kernel = workspace_serving(wasm(1, 4096)).await;
    let id = install(&kernel, "boss", InstallScope::Workspace, BOTH).await;
    let none = send(
        &kernel,
        "alice",
        ALICE,
        &id,
        user("bob"),
        head(1, "workspace"),
    )
    .await;
    assert_eq!(refusal(&none), Some(&AppsRefusal::NoHost));
    advertise(&kernel, "bob", Some(BOB), &id).await;
    let scope = IhttpAddress::Scope {
        app_id: APP_ID.into(),
        scope_key: "workspace".into(),
    };
    let any = send(
        &kernel,
        "alice",
        ALICE,
        &id,
        scope.clone(),
        head(2, "workspace"),
    )
    .await;
    assert_eq!(any, AppsResponse::IhttpSent);
    let mismatch = send(&kernel, "alice", ALICE, &id, scope, head(3, "self:bob")).await;
    assert_eq!(refusal(&mismatch), Some(&AppsRefusal::Policy));
}

#[tokio::test]
async fn advertising_takes_ihttp_serve_and_a_session() {
    let kernel = workspace_serving(wasm(1, 4096)).await;
    let id = install(
        &kernel,
        "boss",
        InstallScope::Workspace,
        &[Capability::IhttpCall],
    )
    .await;
    let ungranted = advertise(&kernel, "bob", Some(BOB), &id).await;
    assert_eq!(
        refusal(&ungranted),
        Some(&AppsRefusal::Ungranted(Capability::IhttpServe))
    );
    let sessionless = advertise(&kernel, "bob", None, &id).await;
    assert_eq!(refusal(&sessionless), Some(&AppsRefusal::Unavailable));
}

#[tokio::test]
async fn calling_takes_ihttp_call_and_a_listed_target() {
    let kernel = workspace_serving(wasm(1, 4096)).await;
    let serve_only = install(
        &kernel,
        "boss",
        InstallScope::Workspace,
        &[Capability::IhttpServe],
    )
    .await;
    advertise(&kernel, "bob", Some(BOB), &serve_only).await;
    let ungranted = send(
        &kernel,
        "alice",
        ALICE,
        &serve_only,
        user("bob"),
        head(1, "workspace"),
    )
    .await;
    assert_eq!(
        refusal(&ungranted),
        Some(&AppsRefusal::Ungranted(Capability::IhttpCall))
    );
    let caller = install(
        &kernel,
        "boss",
        InstallScope::SelfOnly("alice".into()),
        BOTH,
    )
    .await;
    let other = IhttpAddress::User {
        app_id: "com.acme.other".into(),
        username: "bob".into(),
    };
    let unlisted = send(
        &kernel,
        "alice",
        ALICE,
        &caller,
        other,
        head(1, "workspace"),
    )
    .await;
    assert_eq!(
        refusal(&unlisted),
        Some(&AppsRefusal::Ungranted(Capability::IhttpCall))
    );
}

#[tokio::test]
async fn a_caller_outside_the_serving_install_s_scope_finds_no_host() {
    let kernel = workspace_serving(wasm(1, 4096)).await;
    let alices = install(&kernel, "boss", InstallScope::Workspace, BOTH).await;
    let bobs = install(&kernel, "boss", InstallScope::SelfOnly("bob".into()), BOTH).await;
    assert!(matches!(
        advertise(&kernel, "bob", Some(BOB), &bobs).await,
        AppsResponse::Advertised { .. }
    ));
    let outside = send(
        &kernel,
        "alice",
        ALICE,
        &alices,
        user("bob"),
        head(1, "self:bob"),
    )
    .await;
    assert_eq!(refusal(&outside), Some(&AppsRefusal::NoHost));
}

#[tokio::test]
async fn a_host_whose_install_may_no_longer_serve_is_no_host() {
    use citadel_workspace_types::structs::Permission::{
        AppInstallAllowInternalCall, AppInstallAllowInternalServe,
    };
    let kernel = workspace_serving(wasm(1, 4096)).await;
    let backend = &kernel.domain_operations.backend_tx_manager;
    let root = crate::WORKSPACE_ROOT_ID;
    // inst's role may grant both, so inst's install serves; boss's install calls it.
    let mut roles = backend.get_roles(root).await.expect("roles");
    for role in roles.roles.iter_mut().filter(|r| r.id == "installer") {
        role.permissions.insert(AppInstallAllowInternalCall);
        role.permissions.insert(AppInstallAllowInternalServe);
    }
    backend.save_roles(root, &roles).await.expect("save");
    let serving = install(&kernel, "inst", InstallScope::Workspace, BOTH).await;
    let alice_only = InstallScope::SelfOnly("alice".into());
    let calling = install(&kernel, "boss", alice_only, &[Capability::IhttpCall]).await;
    advertise(&kernel, "bob", Some(BOB), &serving).await;
    let served = send(
        &kernel,
        "alice",
        ALICE,
        &calling,
        user("bob"),
        head(1, "workspace"),
    )
    .await;
    assert_eq!(served, AppsResponse::IhttpSent);
    for role in roles.roles.iter_mut().filter(|r| r.id == "installer") {
        role.permissions.remove(&AppInstallAllowInternalServe);
    }
    backend.save_roles(root, &roles).await.expect("save");
    let after = send(
        &kernel,
        "alice",
        ALICE,
        &calling,
        user("bob"),
        head(2, "workspace"),
    )
    .await;
    assert_eq!(refusal(&after), Some(&AppsRefusal::NoHost));
}
