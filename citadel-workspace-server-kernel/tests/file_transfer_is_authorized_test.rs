//! Moving files through the server requires standing, not just a global switch.
//!
//! `allow_server_file_transfer` is one boolean for the whole deployment, and it
//! was the entire gate: `NodeResult::ObjectTransferHandle` auto-accepted every
//! transfer. `Permission::UploadFiles` and `DownloadFiles` were never consulted
//! anywhere in the server, while the permission matrix showed operators a
//! "Files" category with both as per-user toggles — an access control the UI
//! reported and the server did not have.
//!
//! The concrete hole is Guest. `Permission::for_role` grants Guest
//! `ViewContent` and nothing else, and says in its own comment that this makes
//! the role "strictly weaker than Member" — yet a Guest could push files into
//! server storage and pull them back out. Group messaging was given exactly
//! this fix ("a Guest could post into, edit and delete chat in every room it
//! could see"); the file path never received it.

use citadel_types::proto::ObjectTransferOrientation;
use citadel_workspace_types::structs::{Permission, User, UserRole};
use common::workspace_test_utils::{create_test_kernel, TEST_ADMIN_USER_ID};
use std::collections::HashMap;

type Kernel = citadel_workspace_server_kernel::kernel::async_kernel::AsyncWorkspaceServerKernel<
    citadel_sdk::prelude::MonoRatchet,
>;

const UPLOAD: ObjectTransferOrientation = ObjectTransferOrientation::Receiver {
    is_revfs_pull: false,
};
const DOWNLOAD: ObjectTransferOrientation = ObjectTransferOrientation::Sender;

async fn add_user(kernel: &Kernel, id: &str, role: UserRole) {
    let mut user = User {
        id: id.to_string(),
        name: id.to_string(),
        role,
        permissions: HashMap::new(),
        metadata: Default::default(),
    };
    user.set_role_permissions(citadel_workspace_server_kernel::WORKSPACE_ROOT_ID);
    kernel
        .domain_operations
        .backend_tx_manager
        .insert_user(id.to_string(), user)
        .await
        .expect("insert user");
}

/// The role model's own claim, enforced: Guest holds ViewContent and nothing
/// else, so a Guest writes nothing to server storage.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_guest_may_not_upload_or_download() {
    let kernel = create_test_kernel().await;
    add_user(&kernel, "guest", UserRole::Guest).await;

    assert!(
        !kernel.may_transfer(Some("guest"), &UPLOAD).await,
        "Guest holds ViewContent only; it must not be able to put files on the server",
    );
    assert!(
        !kernel.may_transfer(Some("guest"), &DOWNLOAD).await,
        "Guest holds ViewContent only; it must not be able to pull files off the server",
    );
}

/// And the roles that do hold the permission are unaffected — the point of the
/// gate is to separate them, not to switch file transfer off.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_member_may_still_upload_and_download() {
    let kernel = create_test_kernel().await;
    add_user(&kernel, "member", UserRole::Member).await;

    assert!(
        kernel.may_transfer(Some("member"), &UPLOAD).await,
        "Member holds UploadFiles; ordinary file transfer must keep working",
    );
    assert!(
        kernel.may_transfer(Some("member"), &DOWNLOAD).await,
        "Member holds DownloadFiles; ordinary file transfer must keep working",
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_admin_may_still_transfer() {
    let kernel = create_test_kernel().await;
    assert!(
        kernel.may_transfer(Some(TEST_ADMIN_USER_ID), &UPLOAD).await,
        "administration must still work",
    );
}

/// Fail closed. `ObjectTransferHandle` carries only a session CID; if it maps
/// to no live connection there is nobody to authorise, and auto-accepting an
/// unattributed transfer is exactly the behaviour being removed.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_unattributed_transfer_is_refused() {
    let kernel = create_test_kernel().await;

    assert!(
        !kernel.may_transfer(None, &UPLOAD).await,
        "a transfer that cannot be attributed to an account cannot be authorised",
    );
    assert!(
        !kernel
            .may_transfer(Some("nobody-by-that-name"), &UPLOAD)
            .await,
        "an unknown account authorises nothing",
    );
}

/// Direction is read from which way the bytes flow, so the two permissions
/// cannot be transposed.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn direction_selects_the_matching_permission() {
    assert_eq!(
        Kernel::permission_for_transfer(&UPLOAD),
        Permission::UploadFiles
    );
    assert_eq!(
        Kernel::permission_for_transfer(&DOWNLOAD),
        Permission::DownloadFiles
    );
    assert_eq!(
        Kernel::permission_for_transfer(&ObjectTransferOrientation::Receiver {
            is_revfs_pull: true
        }),
        Permission::UploadFiles,
        "a revfs pull still has the server receiving bytes",
    );
}
