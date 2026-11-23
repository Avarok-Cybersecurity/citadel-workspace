//! A first-party app an admin uninstalled stays uninstalled and can be installed again: the
//! catalogue and a listing read keep answering the release the workspace was provisioned with
//! (`FirstPartyReleases`), an install of those exact signed bytes takes it without a module (the
//! UI bundle carries it), and provisioning never puts it back by itself. The workspace's default
//! tabs are not touched by either: the tab is the client's to hide while nothing is installed.

use citadel_workspace_server_kernel::kernel::command_processor::async_process_command::process_command_with_user;
use citadel_workspace_server_kernel::WORKSPACE_ROOT_ID;
use citadel_workspace_types::apps::{Capability, InstallScope};
use citadel_workspace_types::apps_install::{AppsRefusal, InstallState, ListingSource};
use citadel_workspace_types::apps_protocol::{AppsRequest, ListingOffer};
use citadel_workspace_types::apps_responses::{AppListing, AppsResponse};
use citadel_workspace_types::{WorkspaceProtocolRequest, WorkspaceProtocolResponse};
use common::member_test_utils::GateKernel as Kernel;
use common::workspace_test_utils::{create_test_kernel, TEST_ADMIN_USER_ID};
use first_party_signing::{signed_calendar, workspace_installs, Signed, CALENDAR};
use serde_json::{json, Value};

mod first_party_signing;

async fn ask(kernel: &Kernel, request: AppsRequest) -> AppsResponse {
    let request = WorkspaceProtocolRequest::Apps(request);
    match process_command_with_user(kernel, &request, TEST_ADMIN_USER_ID)
        .await
        .expect("dispatched")
    {
        WorkspaceProtocolResponse::Apps(answer) => answer,
        other => panic!("not an apps answer: {other:?}"),
    }
}

async fn calendar_listings(kernel: &Kernel) -> Vec<AppListing> {
    match ask(kernel, AppsRequest::ListCatalogue).await {
        AppsResponse::Catalogue { listings } => listings
            .into_iter()
            .filter(|l| String::from_utf8_lossy(&l.manifest_bytes).contains(CALENDAR))
            .collect(),
        other => panic!("no catalogue: {other:?}"),
    }
}

async fn default_tabs(kernel: &Kernel) -> Value {
    let workspace = kernel
        .domain_operations
        .backend_tx_manager
        .get_workspace(WORKSPACE_ROOT_ID)
        .await
        .expect("read")
        .expect("the root workspace");
    serde_json::from_slice::<Value>(&workspace.metadata).expect("json")["default_app_tabs"].clone()
}

fn install_of(signed: &Signed) -> AppsRequest {
    AppsRequest::Install {
        app_id: CALENDAR.to_string(),
        version: "0.1.0".to_string(),
        listing: ListingOffer::Signed {
            manifest_bytes: signed.manifest.clone(),
            signature: signed.signature.clone(),
        },
        scope: InstallScope::Workspace,
        granted: required_caps(),
        pinned_publisher_key: signed.key.clone(),
        inject_requirement: false,
    }
}

/// What the committed Calendar requires: every capability but the optional `documents`.
fn required_caps() -> Vec<Capability> {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("..");
    let text = std::fs::read(root.join("apps/first-party/calendar/manifest.json")).expect("read");
    let manifest: Value = serde_json::from_slice(&text).expect("json");
    let caps = manifest["capabilities"].as_array().expect("capabilities");
    caps.iter()
        .filter(|c| c["optional"] == json!(false))
        .map(|c| serde_json::from_value(c["cap"].clone()).expect("a capability"))
        .collect()
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn install_uninstall_install_round_trips_and_the_tab_list_is_kept() {
    let kernel = create_test_kernel().await;
    let signed = signed_calendar("5a");
    let trusted = [signed.key.as_str()];
    kernel
        .provision_first_party_apps(&[("calendar", signed.bundle())], &trusted)
        .await
        .expect("provisioned");
    assert_eq!(default_tabs(&kernel).await, json!([CALENDAR]));
    let [listed] = calendar_listings(&kernel)
        .await
        .try_into()
        .expect("one listing");
    assert_eq!(listed.source, ListingSource::FirstParty);
    assert_eq!(listed.manifest_bytes, signed.manifest, "the signed bytes");

    let [install] = workspace_installs(&kernel)
        .await
        .try_into()
        .expect("one install");
    let uninstall = AppsRequest::Uninstall {
        install_id: install.id.clone(),
        purge_storage: false,
    };
    assert!(matches!(
        ask(&kernel, uninstall).await,
        AppsResponse::Uninstalled { .. }
    ));
    assert!(workspace_installs(&kernel).await.is_empty());

    // Still listed, and readable on its own, after the uninstall.
    assert_eq!(calendar_listings(&kernel).await, vec![listed.clone()]);
    let read = ask(
        &kernel,
        AppsRequest::GetListing {
            app_id: CALENDAR.to_string(),
        },
    )
    .await;
    assert_eq!(read, AppsResponse::Listing { listing: listed });

    // A restart's provisioning pass does not undo the admin's uninstall.
    kernel
        .provision_first_party_apps(&[("calendar", signed.bundle())], &trusted)
        .await
        .expect("provisioned again");
    assert!(
        workspace_installs(&kernel).await.is_empty(),
        "uninstalled stays uninstalled"
    );

    let AppsResponse::Installed { install } = ask(&kernel, install_of(&signed)).await else {
        panic!("the Calendar was not installed again");
    };
    assert_eq!(install.source, ListingSource::FirstParty);
    assert_eq!(install.state, InstallState::Active);
    assert_eq!(install.installed_by, TEST_ADMIN_USER_ID);
    assert_eq!(workspace_installs(&kernel).await, vec![install]);
    assert_eq!(
        default_tabs(&kernel).await,
        json!([CALENDAR]),
        "its tab is still listed"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn only_the_recorded_release_installs_without_a_module() {
    let kernel = create_test_kernel().await;
    let recorded = signed_calendar("5a");
    kernel
        .provision_first_party_apps(&[("calendar", recorded.bundle())], &[recorded.key.as_str()])
        .await
        .expect("provisioned");
    let [install] = workspace_installs(&kernel)
        .await
        .try_into()
        .expect("one install");
    let uninstall = AppsRequest::Uninstall {
        install_id: install.id,
        purge_storage: false,
    };
    assert!(matches!(
        ask(&kernel, uninstall).await,
        AppsResponse::Uninstalled { .. }
    ));

    // The same app signed by a key no call trusted: verified as any upload, and the glue ABI is
    // the first-party key's alone.
    let other = signed_calendar("a5");
    assert!(matches!(
        ask(&kernel, install_of(&other)).await,
        AppsResponse::Refused(AppsRefusal::InvalidManifest(_))
    ));
    // The recorded bytes with another release's signature are not the recorded release.
    let forged = Signed {
        signature: other.signature.clone(),
        ..signed_calendar("5a")
    };
    assert!(matches!(
        ask(&kernel, install_of(&forged)).await,
        AppsResponse::Refused(_)
    ));
    assert!(workspace_installs(&kernel).await.is_empty());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_workspace_with_no_first_party_release_lists_none() {
    let kernel = create_test_kernel().await;
    assert!(
        calendar_listings(&kernel).await.is_empty(),
        "a test build embeds no release"
    );
    let read = ask(
        &kernel,
        AppsRequest::GetListing {
            app_id: CALENDAR.to_string(),
        },
    )
    .await;
    assert_eq!(read, AppsResponse::Refused(AppsRefusal::Unavailable));
}
