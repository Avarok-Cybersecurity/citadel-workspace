//! The other members hear that an install or a member's answers changed, and nothing else: no
//! install id, no consent, no block list. The member who asked is answered as before.

use super::test_manifests::*;
use super::test_runtime::ask_on;
use super::test_support::Kernel;
use crate::kernel::async_kernel::{BroadcastAudience, BroadcastMessage};
use crate::WorkspaceProtocolResponse;
use citadel_workspace_types::apps::{Capability, InstallScope};
use citadel_workspace_types::apps_protocol::AppsRequest;
use citadel_workspace_types::apps_responses::AppsResponse;
use tokio::sync::broadcast::Receiver;

const INST: u64 = 10;
const ALICE: u64 = 11;

type Notice = (AppsResponse, BroadcastAudience, Option<u64>);

/// `inst`'s workspace install of the served test module (as kernel_lifecycle_tests makes it).
async fn install(kernel: &Kernel) -> String {
    let (key, spec, bytes) = (publisher(1), Spec::new("1.0.0"), wasm(1, 4096));
    let offer = signed(&spec, &key, &bytes);
    let request = install_request(
        &spec,
        &key,
        offer,
        InstallScope::Workspace,
        &[Capability::Canvas, Capability::NodesRead],
        false,
    );
    match ask_on(kernel, "inst", Some(INST), request).await {
        AppsResponse::Installed { install } => install.id,
        other => panic!("{other:?}"),
    }
}

async fn serving() -> Kernel {
    workspace_serving(wasm(1, 4096)).await
}

/// Every apps message pushed since the last call.
fn notices(rx: &mut Receiver<BroadcastMessage>) -> Vec<Notice> {
    let mut out = Vec::new();
    while let Ok(m) = rx.try_recv() {
        if let WorkspaceProtocolResponse::Apps(a) = m.response {
            out.push((a, m.audience, m.exclude_cid));
        }
    }
    out
}

/// `what`, to the workspace's members, skipping the session `asker` that was answered.
fn members(what: AppsResponse, asker: u64) -> Vec<Notice> {
    let workspace = BroadcastAudience::Workspace(crate::WORKSPACE_ROOT_ID.to_string());
    vec![(what, workspace, Some(asker))]
}

#[tokio::test]
async fn an_install_and_its_removal_tell_the_other_members_to_read_their_installs_again() {
    let kernel = serving().await;
    let mut rx = kernel.subscribe_broadcast();
    let id = install(&kernel).await;
    assert_eq!(
        notices(&mut rx),
        members(AppsResponse::InstallsChanged, INST)
    );
    let uninstall = AppsRequest::Uninstall {
        install_id: id,
        purge_storage: false,
    };
    let answer = ask_on(&kernel, "inst", Some(INST), uninstall).await;
    assert!(
        matches!(answer, AppsResponse::Uninstalled { .. }),
        "{answer:?}"
    );
    assert_eq!(
        notices(&mut rx),
        members(AppsResponse::InstallsChanged, INST)
    );
}

#[tokio::test]
async fn a_members_own_answers_tell_the_others_only_that_answers_changed() {
    let kernel = serving().await;
    let id = install(&kernel).await;
    let mut rx = kernel.subscribe_broadcast();
    let consent = AppsRequest::SetPeerConsentForMe {
        install_id: id.clone(),
        serve: true,
        call: false,
        topics: true,
    };
    let answer = ask_on(&kernel, "alice", Some(ALICE), consent).await;
    assert!(
        matches!(answer, AppsResponse::PeerConsentForMe { .. }),
        "{answer:?}"
    );
    assert_eq!(
        notices(&mut rx),
        members(AppsResponse::PeerAnswersChanged, ALICE)
    );
    let hide = AppsRequest::SetDisabledForMe {
        install_id: id,
        disabled: true,
    };
    let answer = ask_on(&kernel, "alice", Some(ALICE), hide).await;
    assert!(
        matches!(answer, AppsResponse::DisabledForMe { .. }),
        "{answer:?}"
    );
    assert_eq!(
        notices(&mut rx),
        members(AppsResponse::PeerAnswersChanged, ALICE)
    );
}

#[tokio::test]
async fn control_a_read_or_a_refusal_tells_nobody_anything() {
    let kernel = serving().await;
    let id = install(&kernel).await;
    let mut rx = kernel.subscribe_broadcast();
    ask_on(&kernel, "alice", Some(ALICE), AppsRequest::ListInstalls).await;
    let refused = AppsRequest::Uninstall {
        install_id: id,
        purge_storage: false,
    };
    let answer = ask_on(&kernel, "bob", Some(20), refused).await;
    assert!(matches!(answer, AppsResponse::Refused(_)), "{answer:?}");
    assert_eq!(notices(&mut rx), vec![]);
}
