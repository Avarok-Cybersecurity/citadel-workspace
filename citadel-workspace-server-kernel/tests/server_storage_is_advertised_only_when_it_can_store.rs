//! `GetServerCapabilities` advertises RE-VFS storage only when the server can store a file.
//!
//! The configuration allowed it and the response repeated the configuration, so a server on a
//! backend the SDK will not stream objects into told every client it had storage, and every
//! upload then failed with "File transfer is not enabled for this session". The rule itself is
//! unit-tested against each backend in `kernel::server_capabilities`; this drives the request a
//! client sends, through the dispatch every request takes.

use citadel_workspace_server_kernel::kernel::command_processor::async_process_command::process_command_with_user;
use citadel_workspace_types::{WorkspaceProtocolRequest, WorkspaceProtocolResponse};
use common::workspace_test_utils::create_test_kernel;

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_server_with_nowhere_to_store_files_does_not_offer_storage() {
    let kernel = create_test_kernel().await;
    assert!(
        kernel.file_transfer_config().allow_server_revfs_storage,
        "the configuration must allow storage, or this proves nothing about the backend"
    );

    let response = process_command_with_user(
        &kernel,
        &WorkspaceProtocolRequest::GetServerCapabilities,
        "any-user",
    )
    .await
    .expect("GetServerCapabilities is answered");

    match response {
        WorkspaceProtocolResponse::ServerCapabilities {
            allow_server_revfs_storage,
            ..
        } => assert!(
            !allow_server_revfs_storage,
            "a kernel with no backend to store into advertised RE-VFS storage"
        ),
        other => panic!("expected ServerCapabilities, got {other:?}"),
    }
}
