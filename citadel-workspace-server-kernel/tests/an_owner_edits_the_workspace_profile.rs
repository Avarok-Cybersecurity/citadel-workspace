//! Renaming a workspace, describing it and giving it an icon, without the master password.
//!
//! Live (owner, 2026-09-27): "I can't find where to edit the workspace settings (name of org,
//! icon, etc)". The only request that renamed a workspace, UpdateWorkspace, demands the master
//! password -- the credential that also claims and deletes it -- so no settings screen could
//! offer a rename to an owner who does not keep it to hand. UpdateWorkspaceProfile is gated on
//! Permission::UpdateWorkspace instead, as UpdateWorkspaceTheme is on Permission::Themes.
//!
//! No mocks: the real command processor, storage and broadcast channel.
use base64::Engine;
use citadel_workspace_server_kernel::kernel::command_processor::async_process_command::process_command_with_user;
use citadel_workspace_server_kernel::WORKSPACE_ROOT_ID;
use citadel_workspace_types::structs::{UserRole, Workspace, WorkspaceLogoChange};
use citadel_workspace_types::{WorkspaceProtocolRequest, WorkspaceProtocolResponse};
use common::member_test_utils::{insert_user_with_role, join_root, GateKernel as Kernel};
use common::workspace_test_utils::{create_test_kernel, TEST_ADMIN_PASSWORD, TEST_ADMIN_USER_ID};
use std::time::Duration;

const PNG_MAGIC: &[u8] = b"\x89PNG\r\n\x1a\n";

fn data_url(mime: &str, bytes: &[u8]) -> String {
    format!(
        "data:{mime};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    )
}

fn png(len: usize) -> String {
    let mut bytes = PNG_MAGIC.to_vec();
    bytes.resize(len, 0);
    data_url("image/png", &bytes)
}

fn profile(name: Option<&str>, logo: Option<WorkspaceLogoChange>) -> WorkspaceProtocolRequest {
    WorkspaceProtocolRequest::UpdateWorkspaceProfile {
        workspace_id: None,
        name: name.map(str::to_string),
        description: None,
        logo,
    }
}

async fn send(
    kernel: &Kernel,
    request: WorkspaceProtocolRequest,
    user: &str,
) -> WorkspaceProtocolResponse {
    process_command_with_user(kernel, &request, user)
        .await
        .expect("dispatch failed")
}

async fn stored(kernel: &Kernel) -> Workspace {
    kernel
        .domain_operations
        .backend_tx_manager
        .get_workspace(WORKSPACE_ROOT_ID)
        .await
        .expect("read failed")
        .expect("the root workspace exists")
}

/// A workspace nothing has written metadata to holds no bytes at all: no keys, not an error.
fn metadata(workspace: &Workspace) -> serde_json::Value {
    if workspace.metadata.is_empty() {
        return serde_json::json!({});
    }
    serde_json::from_slice(&workspace.metadata).expect("metadata is JSON")
}

fn error_of(response: &WorkspaceProtocolResponse) -> &str {
    match response {
        WorkspaceProtocolResponse::Error(e) => e,
        other => panic!("expected a refusal, got {other:?}"),
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_owner_renames_without_the_master_password_and_members_hear_it() {
    let kernel = create_test_kernel().await;
    let mut rx = kernel.subscribe_broadcast();

    let response = send(
        &kernel,
        profile(Some("  Avarok Labs  "), None),
        TEST_ADMIN_USER_ID,
    )
    .await;
    assert!(
        matches!(&response, WorkspaceProtocolResponse::Workspace(w) if w.name == "Avarok Labs"),
        "the rename is answered with the trimmed name; got {response:?}"
    );
    assert_eq!(stored(&kernel).await.name, "Avarok Labs");

    let mut heard = false;
    while let Ok(Ok(msg)) = tokio::time::timeout(Duration::from_millis(200), rx.recv()).await {
        heard |= matches!(&msg.response, WorkspaceProtocolResponse::Workspace(w) if w.name == "Avarok Labs");
    }
    assert!(
        heard,
        "a rename reaching only its author leaves every switcher showing the old name"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_member_without_the_permission_is_refused_the_same_whatever_they_send() {
    let kernel = create_test_kernel().await;
    insert_user_with_role(&kernel, "mia", UserRole::Member).await;
    join_root(&kernel, "mia").await;

    let valid = send(&kernel, profile(Some("Mine now"), None), "mia").await;
    let invalid = send(
        &kernel,
        profile(
            Some(""),
            Some(WorkspaceLogoChange::Set {
                data_url: "junk".into(),
            }),
        ),
        "mia",
    )
    .await;
    assert_eq!(
        error_of(&valid),
        error_of(&invalid),
        "a refusal that varies with the input is an oracle"
    );
    assert_ne!(stored(&kernel).await.name, "Mine now");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_icon_is_stored_and_cleared_without_touching_the_rest_of_the_metadata() {
    let kernel = create_test_kernel().await;
    let theme = WorkspaceProtocolRequest::UpdateWorkspaceTheme {
        workspace_id: None,
        theme: br##"{"name":"Avarok"}"##.to_vec(),
    };
    assert!(matches!(
        send(&kernel, theme, TEST_ADMIN_USER_ID).await,
        WorkspaceProtocolResponse::Workspace(_)
    ));
    let initialise = WorkspaceProtocolRequest::UpdateWorkspace {
        workspace_id: None,
        name: None,
        description: None,
        workspace_master_password: TEST_ADMIN_PASSWORD.to_string(),
        metadata: Some(br#"{"initialized":true}"#.to_vec()),
    };
    assert!(matches!(
        send(&kernel, initialise, TEST_ADMIN_USER_ID).await,
        WorkspaceProtocolResponse::Workspace(_)
    ));
    let before = stored(&kernel).await;

    let icon = png(512);
    let set = profile(
        None,
        Some(WorkspaceLogoChange::Set {
            data_url: icon.clone(),
        }),
    );
    assert!(matches!(
        send(&kernel, set, TEST_ADMIN_USER_ID).await,
        WorkspaceProtocolResponse::Workspace(_)
    ));
    let after = stored(&kernel).await;
    let meta = metadata(&after);
    assert_eq!(meta["logo"], serde_json::Value::String(icon));
    assert_eq!(
        meta["initialized"],
        serde_json::Value::Bool(true),
        "the icon erased the initialisation marker"
    );
    assert_eq!(meta["theme"]["name"], "Avarok", "the icon erased the theme");
    assert_eq!(
        (
            after.name.as_str(),
            after.members.clone(),
            after.owner_id.clone()
        ),
        (before.name.as_str(), before.members, before.owner_id)
    );

    let clear = profile(None, Some(WorkspaceLogoChange::Clear));
    assert!(matches!(
        send(&kernel, clear, TEST_ADMIN_USER_ID).await,
        WorkspaceProtocolResponse::Workspace(_)
    ));
    assert_eq!(
        metadata(&stored(&kernel).await)["logo"],
        serde_json::Value::Null
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_icon_that_is_not_a_small_raster_image_is_refused() {
    let kernel = create_test_kernel().await;
    let svg = data_url("image/svg+xml", b"<svg onload=\"alert(1)\"/>");
    let too_big = png(32 * 1024 + 1);
    let mislabelled = data_url("image/png", b"<html>not a png</html>");
    let not_base64 = String::from("data:image/png;base64,!!!!");
    for bad in [svg, too_big, mislabelled, not_base64] {
        let response = send(
            &kernel,
            profile(
                None,
                Some(WorkspaceLogoChange::Set {
                    data_url: bad.clone(),
                }),
            ),
            TEST_ADMIN_USER_ID,
        )
        .await;
        assert!(
            matches!(response, WorkspaceProtocolResponse::Error(_)),
            "accepted {}",
            &bad[..bad.len().min(40)]
        );
    }
    assert!(
        metadata(&stored(&kernel).await).get("logo").is_none(),
        "a refused icon was stored"
    );

    let at_limit = png(32 * 1024);
    let response = send(
        &kernel,
        profile(None, Some(WorkspaceLogoChange::Set { data_url: at_limit })),
        TEST_ADMIN_USER_ID,
    )
    .await;
    assert!(
        matches!(response, WorkspaceProtocolResponse::Workspace(_)),
        "an icon exactly at the limit is allowed; got {response:?}"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_name_that_cannot_be_shown_is_refused() {
    let kernel = create_test_kernel().await;
    let long: String = "x".repeat(citadel_workspace_server_kernel::MAX_WORKSPACE_NAME_CHARS + 1);
    for bad in ["", "   ", "tab\there", long.as_str()] {
        let response = send(&kernel, profile(Some(bad), None), TEST_ADMIN_USER_ID).await;
        assert!(
            matches!(response, WorkspaceProtocolResponse::Error(_)),
            "accepted name {bad:?}"
        );
    }
}
