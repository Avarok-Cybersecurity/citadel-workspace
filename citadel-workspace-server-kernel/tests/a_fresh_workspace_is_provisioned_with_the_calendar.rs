//! The Calendar is installed when a workspace is provisioned (Calendar design §3.2, C11): from a
//! release signed by a first-party key, an Active install for the whole workspace with what the
//! manifest requires, its release stored as signed, once however often provisioning runs. A
//! release signed by any other key installs nothing and fails the pass, as does a first-party
//! release on the sandboxed ABI, whose module the server does not carry.
//!
//! The deploy's key cannot sign here, so the committed manifest and the vendored glue binary are
//! signed with a throwaway seed, trusted only by these calls, exactly as the signer would
//! (apps/first-party/signer: the signer's key written into the manifest, pretty-printed with a
//! final newline, the signature over its digest and the module's).

use citadel_workspace_server_kernel::kernel::command_processor::async_process_command::process_command_with_user;
use citadel_workspace_server_kernel::kernel::command_processor::PROVISIONING_INSTALLER;
use citadel_workspace_types::apps::Capability;
use citadel_workspace_types::apps_install::{InstallState, ListingSource};
use citadel_workspace_types::apps_protocol::AppsRequest;
use citadel_workspace_types::apps_responses::AppsResponse;
use citadel_workspace_types::{WorkspaceProtocolRequest, WorkspaceProtocolResponse};
use common::workspace_test_utils::{create_test_kernel, TEST_ADMIN_USER_ID};
use first_party_signing::{signed, signed_calendar, workspace_installs, CALENDAR};

mod first_party_signing;

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_first_party_release_is_installed_once_for_the_workspace() {
    let kernel = create_test_kernel().await;
    assert!(
        workspace_installs(&kernel).await.is_empty(),
        "a test build embeds no release"
    );
    let signed = signed_calendar("5a");
    let bundles = [("calendar", signed.bundle())];

    kernel
        .provision_first_party_apps(&bundles, &[signed.key.as_str()])
        .await
        .expect("provisioned");
    kernel
        .provision_first_party_apps(&bundles, &[signed.key.as_str()])
        .await
        .expect("provisioned again");

    let installs = workspace_installs(&kernel).await;
    let [install] = installs.as_slice() else {
        panic!("one Calendar install, not {installs:?}");
    };
    assert_eq!(install.app_id, CALENDAR);
    assert_eq!(install.state, InstallState::Active);
    assert_eq!(install.source, ListingSource::FirstParty);
    assert_eq!(install.installed_by, PROVISIONING_INSTALLER);
    assert_eq!(install.pinned_publisher_key, signed.key);
    assert!(install.granted.contains(&Capability::StorageNodeAuthored));
    assert!(
        install.granted.contains(&Capability::Notifications),
        "reminders reach the member only through the notifications grant"
    );
    assert!(
        !install.granted.contains(&Capability::Documents),
        "optional: an admin grants it"
    );
    assert_eq!(install.details.topics, ["cal"]);

    let request = WorkspaceProtocolRequest::Apps(AppsRequest::GetRelease {
        install_id: install.id.clone(),
    });
    match process_command_with_user(&kernel, &request, TEST_ADMIN_USER_ID)
        .await
        .expect("dispatched")
    {
        WorkspaceProtocolResponse::Apps(AppsResponse::Release { current, .. }) => {
            assert_eq!(
                current.manifest_bytes, signed.manifest,
                "the signed bytes, verbatim"
            );
            assert_eq!(current.signature, signed.signature);
        }
        other => panic!("no release: {other:?}"),
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_release_no_trusted_key_signed_installs_nothing_and_fails_the_pass() {
    let kernel = create_test_kernel().await;
    let signed = signed_calendar("5a");
    let other = signed_calendar("a5");
    let refused = kernel
        .provision_first_party_apps(&[("calendar", signed.bundle())], &[other.key.as_str()])
        .await;
    assert!(refused.is_err());
    let none: [&str; 0] = [];
    let refused = kernel
        .provision_first_party_apps(&[("calendar", signed.bundle())], &none)
        .await;
    assert!(refused.is_err(), "no trusted key: nothing is first-party");
    assert!(workspace_installs(&kernel).await.is_empty());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_first_party_release_the_server_cannot_run_is_not_provisioned() {
    let kernel = create_test_kernel().await;
    let pool = signed(
        "apps/first-party/compute-pool/manifest.json",
        "apps/first-party/compute-pool/wasm/compute-pool.wasm",
        "5a",
    );
    let refused = kernel
        .provision_first_party_apps(&[("compute-pool", pool.bundle())], &[pool.key.as_str()])
        .await;
    assert!(
        refused.is_err(),
        "its module is not in the UI bundle, and this bundle carries none"
    );
    assert!(workspace_installs(&kernel).await.is_empty());
}
