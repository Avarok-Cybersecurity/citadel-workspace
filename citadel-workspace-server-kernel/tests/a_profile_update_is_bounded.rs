use citadel_workspace_server_kernel::kernel::command_processor::async_process_command::process_command_with_user;
use citadel_workspace_server_kernel::kernel::profile_limits::MAX_AVATAR_BASE64_LEN;
use citadel_workspace_types::structs::{MetadataValue, User, UserRole};
use citadel_workspace_types::{WorkspaceProtocolRequest, WorkspaceProtocolResponse};

use common::workspace_test_utils::*;

// # Any account could grow the store without limit through its own profile
//
// UpdateUserProfile wrote `name` and `avatar_data` into the user record with no
// length check. Registration is open on a public server, so a stranger could
// register and send one request carrying a multi-megabyte string. Asserted on
// what is STORED, not only on the response: a handler that answers "Error"
// after writing would pass a response-only check.

const USER: &str = "stranger";

async fn kernel_with_user() -> std::sync::Arc<
    citadel_workspace_server_kernel::kernel::async_kernel::AsyncWorkspaceServerKernel<
        citadel_sdk::prelude::MonoRatchet,
    >,
> {
    let kernel = create_test_kernel().await;
    kernel
        .domain_operations
        .backend_tx_manager
        .insert_user(
            USER.to_string(),
            User::new(USER.to_string(), "Stranger".to_string(), UserRole::Member),
        )
        .await
        .expect("insert user");
    kernel
}

async fn update(
    kernel: &citadel_workspace_server_kernel::kernel::async_kernel::AsyncWorkspaceServerKernel<
        citadel_sdk::prelude::MonoRatchet,
    >,
    name: Option<String>,
    avatar: Option<String>,
) -> WorkspaceProtocolResponse {
    process_command_with_user(
        kernel,
        &WorkspaceProtocolRequest::UpdateUserProfile {
            name,
            avatar_data: avatar,
            email: None,
            title: None,
            show_profile_to_strangers: None,
            accepts_requests_from_strangers: None,
        },
        USER,
    )
    .await
    .expect("dispatch")
}

async fn stored(
    kernel: &citadel_workspace_server_kernel::kernel::async_kernel::AsyncWorkspaceServerKernel<
        citadel_sdk::prelude::MonoRatchet,
    >,
) -> (String, Option<usize>) {
    let user = kernel
        .domain_operations
        .backend_tx_manager
        .get_user(USER)
        .await
        .expect("read user")
        .expect("user exists");
    let avatar = match user.metadata.get("avatar") {
        Some(MetadataValue::String(s)) => Some(s.len()),
        _ => None,
    };
    (user.name, avatar)
}

#[tokio::test]
async fn an_oversized_avatar_is_refused_and_not_stored() {
    let kernel = kernel_with_user().await;
    let response = update(&kernel, None, Some("A".repeat(MAX_AVATAR_BASE64_LEN + 1))).await;
    assert!(
        matches!(response, WorkspaceProtocolResponse::Error(_)),
        "accepted: {response:?}"
    );
    assert_eq!(
        stored(&kernel).await.1,
        None,
        "the refused avatar was written anyway"
    );
}

#[tokio::test]
async fn the_largest_avatar_the_app_can_produce_is_accepted() {
    // An incompressible 256x256 RGBA PNG is about 351 KB as base64.
    let kernel = kernel_with_user().await;
    let response = update(&kernel, None, Some("A".repeat(360 * 1024))).await;
    assert!(
        matches!(response, WorkspaceProtocolResponse::UserProfileUpdated(_)),
        "refused: {response:?}"
    );
    assert_eq!(stored(&kernel).await.1, Some(360 * 1024));
}

#[tokio::test]
async fn a_display_name_follows_the_registration_rule() {
    let reqs = citadel_sdk::prelude::ServerMiscSettings::default().credential_requirements;
    let (min, max) = (reqs.min_name_length as usize, reqs.max_name_length as usize);
    let kernel = kernel_with_user().await;

    for (label, name) in [
        ("too long", "n".repeat(max + 1)),
        ("too short", "n".repeat(min - 1)),
        ("a megabyte", "n".repeat(1 << 20)),
    ] {
        let response = update(&kernel, Some(name), None).await;
        assert!(
            matches!(response, WorkspaceProtocolResponse::Error(_)),
            "{label} name accepted: {response:?}"
        );
        assert_eq!(
            stored(&kernel).await.0,
            "Stranger",
            "a refused {label} name was written anyway"
        );
    }

    let response = update(&kernel, Some("n".repeat(max)), None).await;
    assert!(
        matches!(response, WorkspaceProtocolResponse::UserProfileUpdated(_)),
        "a {max}-byte name refused: {response:?}"
    );
    assert_eq!(stored(&kernel).await.0, "n".repeat(max));
}
