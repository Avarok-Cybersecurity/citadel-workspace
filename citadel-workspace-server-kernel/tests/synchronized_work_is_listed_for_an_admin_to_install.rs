//! synchronized.work, a first-party app on the app ABI, is offered to every workspace and
//! installed by none: provisioning lists the committed release and stores the module it carries,
//! and an admin installs it on a node through the ordinary install, with no upload and no fetcher,
//! after which the member's agent is granted its one server.
//!
//! The committed manifest and module are signed with a throwaway seed trusted only by these calls
//! (`first_party_signing`), exactly as the signer would.

use citadel_workspace_server_kernel::kernel::command_processor::async_process_command::process_command_with_user;
use citadel_workspace_server_kernel::WORKSPACE_ROOT_ID;
use citadel_workspace_types::apps::{Capability, InstallScope};
use citadel_workspace_types::apps_install::{InstallState, ListingSource};
use citadel_workspace_types::apps_manifest_session::SessionLimits;
use citadel_workspace_types::apps_protocol::{AppsRequest, ListingOffer};
use citadel_workspace_types::apps_responses::{AppListing, AppsResponse};
use citadel_workspace_types::structs::NodeEntityType;
use citadel_workspace_types::{WorkspaceProtocolRequest, WorkspaceProtocolResponse};
use common::member_test_utils::GateKernel as Kernel;
use common::workspace_test_utils::{create_test_kernel, TEST_ADMIN_USER_ID};
use first_party_signing::{signed_with_module, workspace_installs, Signed};

mod first_party_signing;

const APP: &str = "work.synchronized.app";
const MANIFEST: &str = "apps/first-party/synchronized-work/manifest.json";
const MODULE: &str = "apps/first-party/synchronized-work/wasm/synchronized-work.wasm";

async fn send(kernel: &Kernel, request: WorkspaceProtocolRequest) -> WorkspaceProtocolResponse {
    process_command_with_user(kernel, &request, TEST_ADMIN_USER_ID)
        .await
        .expect("dispatched")
}

async fn ask(kernel: &Kernel, request: AppsRequest) -> AppsResponse {
    match send(kernel, WorkspaceProtocolRequest::Apps(request)).await {
        WorkspaceProtocolResponse::Apps(answer) => answer,
        other => panic!("not an apps answer: {other:?}"),
    }
}

async fn listings(kernel: &Kernel) -> Vec<AppListing> {
    match ask(kernel, AppsRequest::ListCatalogue).await {
        AppsResponse::Catalogue { listings } => listings
            .into_iter()
            .filter(|l| String::from_utf8_lossy(&l.manifest_bytes).contains(APP))
            .collect(),
        other => panic!("no catalogue: {other:?}"),
    }
}

async fn office(kernel: &Kernel) -> String {
    let request = WorkspaceProtocolRequest::CreateNode {
        parent_id: Some(WORKSPACE_ROOT_ID.to_string()),
        entity_type: NodeEntityType::Child("Office".to_string()),
        name: "Engineering".to_string(),
        description: String::new(),
        metadata: None,
    };
    match send(kernel, request).await {
        WorkspaceProtocolResponse::Node(node) => node.id,
        other => panic!("no node: {other:?}"),
    }
}

fn install_at(signed: &Signed, node: &str) -> AppsRequest {
    AppsRequest::Install {
        app_id: APP.to_string(),
        version: "0.1.0".to_string(),
        listing: ListingOffer::Signed {
            manifest_bytes: signed.manifest.clone(),
            signature: signed.signature.clone(),
        },
        scope: InstallScope::Node(node.to_string()),
        granted: vec![
            Capability::Canvas,
            Capability::CitadelSession,
            Capability::StorageUser,
        ],
        pinned_publisher_key: signed.key.clone(),
        inject_requirement: false,
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn listed_then_installed_by_an_admin_at_a_node_from_the_stored_module() {
    let kernel = create_test_kernel().await;
    let signed = signed_with_module(MANIFEST, MODULE, "5a");
    let bundles = [("synchronized-work", signed.bundle())];
    kernel
        .provision_first_party_apps(&bundles, &[signed.key.as_str()])
        .await
        .expect("provisioned");

    let [listed] = listings(&kernel).await.try_into().expect("one listing");
    assert_eq!(listed.source, ListingSource::FirstParty);
    assert_eq!(listed.manifest_bytes, signed.manifest, "the signed bytes");
    assert!(
        workspace_installs(&kernel).await.is_empty(),
        "listed, not installed"
    );

    let node = office(&kernel).await;
    let AppsResponse::Installed { install } = ask(&kernel, install_at(&signed, &node)).await else {
        panic!("not installed from the stored module")
    };
    assert_eq!(install.source, ListingSource::FirstParty);
    assert_eq!(install.state, InstallState::Active);
    assert_eq!(install.scope, InstallScope::Node(node));

    let request = AppsRequest::HostNetGrant {
        install_id: install.id.clone(),
        tag: 1,
    };
    let AppsResponse::HostNetGrant { grant, .. } = ask(&kernel, request).await else {
        panic!("no grant answer")
    };
    let grant = grant.expect("citadel.session was granted");
    assert_eq!(grant.servers, ["synchronized.work"]);
    assert_eq!(
        grant.session,
        Some(SessionLimits {
            max_msg_bytes: 65536,
            max_msgs_per_s: 8,
        })
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn without_its_module_it_is_neither_listed_nor_provisioned() {
    let kernel = create_test_kernel().await;
    let bare = Signed {
        module: None,
        ..signed_with_module(MANIFEST, MODULE, "5a")
    };
    let refused = kernel
        .provision_first_party_apps(
            &[("synchronized-work", bare.bundle())],
            &[bare.key.as_str()],
        )
        .await;
    assert!(refused.is_err());
    assert!(listings(&kernel).await.is_empty());
}
