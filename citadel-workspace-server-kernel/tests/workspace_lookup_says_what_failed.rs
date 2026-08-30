use citadel_workspace_types::{WorkspaceProtocolRequest, WorkspaceProtocolResponse};

use common::async_test_helpers::*;
use common::workspace_test_utils::*;

/// # A failed workspace lookup must not always mean "you have no workspace"
///
/// `GetWorkspace` decided its answer by searching the error's PROSE:
///
/// ```ignore
/// if error_msg.contains("not found") || error_msg.contains("Not a member")
/// ```
///
/// `WorkspaceNotInitialized` is not a small thing to say. The client treats it
/// as "this server has never been set up" and shows the first-run flow, which
/// asks for the workspace master password and offers to create the workspace.
/// Saying it to somebody whose workspace exists and is fine sends them to
/// re-initialise a live server.
///
/// A substring search says it for anything whose message happens to contain
/// those words — including asking about a workspace id that simply does not
/// exist, which is a wrong id, not an uninitialised server.
///
/// This test drives the real command processor, so it fails if the decision
/// goes back to reading prose, and it fails if the prose changes underneath a
/// decision that depends on it.

#[tokio::test]
async fn an_unknown_workspace_id_is_not_an_uninitialised_server() {
    let kernel = create_test_kernel().await;

    let response = execute_command(
        &kernel,
        WorkspaceProtocolRequest::GetWorkspace {
            workspace_id: Some("no-such-workspace-8b1f".to_string()),
        },
    )
    .await
    .expect("the command processor answers rather than erroring out");

    assert!(
        !matches!(response, WorkspaceProtocolResponse::WorkspaceNotInitialized),
        "asking about an id that does not exist told the client its own workspace \
         was never set up, which sends it into the first-run flow; got {response:?}"
    );
}

#[tokio::test]
async fn the_real_workspace_still_resolves() {
    // The positive control. Without it the assertion above is satisfied by a
    // GetWorkspace that has stopped working entirely.
    let kernel = create_test_kernel().await;

    let response = execute_command(
        &kernel,
        WorkspaceProtocolRequest::GetWorkspace { workspace_id: None },
    )
    .await
    .expect("the root workspace resolves");

    assert!(
        matches!(response, WorkspaceProtocolResponse::Workspace(_)),
        "the root workspace should still be returned; got {response:?}"
    );
}
