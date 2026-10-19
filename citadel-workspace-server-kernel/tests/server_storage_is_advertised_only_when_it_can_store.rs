//! `GetServerCapabilities` advertises server file transfer and RE-VFS storage only when the
//! server can store a file, and says why when it cannot.
//!
//! The configuration allowed both and the response repeated the configuration, so a server on
//! a backend the SDK will not stream objects into told every client it could take files, and
//! every upload then failed with "File transfer is not enabled for this session". The rule is
//! unit-tested against each backend in `kernel::server_capabilities`; these drive the request a
//! client sends, through the dispatch every request takes, on a kernel attached to a real
//! server node built on the backend under test.

use citadel_internal_service_test_common::server_test_node_skip_cert_verification;
use citadel_sdk::prelude::{BackendType, StackedRatchet};
use citadel_workspace_server_kernel::kernel::async_kernel::AsyncWorkspaceServerKernel;
use citadel_workspace_server_kernel::kernel::command_processor::async_process_command::process_command_with_user;
use citadel_workspace_types::server_feature_refusal::ServerFeatureRefusal;
use citadel_workspace_types::{WorkspaceProtocolRequest, WorkspaceProtocolResponse};
use common::workspace_test_utils::create_test_kernel;
use std::time::Duration;

/// The four capability fields that matter here, in the order the response carries them.
type Offer = (
    bool,
    Option<ServerFeatureRefusal>,
    bool,
    Option<ServerFeatureRefusal>,
);

async fn offer_of(
    kernel: &AsyncWorkspaceServerKernel<impl citadel_sdk::prelude::Ratchet>,
) -> Offer {
    let config = kernel.file_transfer_config();
    assert!(
        config.allow_server_revfs_storage && config.allow_server_file_transfer,
        "the configuration must allow both, or this proves nothing about the backend"
    );
    let request = WorkspaceProtocolRequest::GetServerCapabilities;
    match process_command_with_user(kernel, &request, "any-user").await {
        Ok(WorkspaceProtocolResponse::ServerCapabilities {
            allow_server_file_transfer,
            file_transfer_refusal,
            allow_server_revfs_storage,
            revfs_storage_refusal,
            ..
        }) => (
            allow_server_file_transfer,
            file_transfer_refusal,
            allow_server_revfs_storage,
            revfs_storage_refusal,
        ),
        other => panic!("expected ServerCapabilities, got {other:?}"),
    }
}

/// A kernel attached to a running server node on `backend`.
async fn served_on(backend: BackendType) -> AsyncWorkspaceServerKernel<StackedRatchet> {
    let kernel = AsyncWorkspaceServerKernel::<StackedRatchet>::with_workspace_master_password(
        "capabilities-test-password",
    )
    .await
    .expect("kernel");
    let (server, _addr) = server_test_node_skip_cert_verification(kernel.clone(), |builder| {
        builder.with_backend(backend);
    });
    tokio::task::spawn(server);
    for _ in 0..200 {
        if kernel.is_healthy() {
            return kernel;
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
    panic!("the server node never attached to the kernel");
}

fn cannot_store(backend: &str) -> Option<ServerFeatureRefusal> {
    Some(ServerFeatureRefusal::BackendCannotStoreStreamedObjects {
        backend: backend.to_string(),
    })
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_in_memory_server_offers_no_file_features_and_says_why() {
    let kernel = served_on(BackendType::InMemory).await;
    let expected = (
        false,
        cannot_store("InMemory"),
        false,
        cannot_store("InMemory"),
    );
    assert_eq!(offer_of(&kernel).await, expected);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_filesystem_server_offers_both_with_no_refusal() {
    let dir = tempfile::tempdir().expect("tempdir");
    let path = dir.path().to_str().expect("utf-8 path").to_string();
    let kernel = served_on(BackendType::Filesystem(path)).await;
    assert_eq!(offer_of(&kernel).await, (true, None, true, None));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_kernel_with_no_node_offers_no_file_features() {
    let kernel = create_test_kernel().await;
    let none = Some(ServerFeatureRefusal::NoBackend);
    assert_eq!(offer_of(&kernel).await, (false, none.clone(), false, none));
}
