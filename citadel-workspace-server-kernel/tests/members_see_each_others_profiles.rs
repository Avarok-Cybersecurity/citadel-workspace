use citadel_workspace_server_kernel::kernel::command_processor::async_process_command::process_command_with_user;
use citadel_workspace_types::structs::{MetadataValue, User, UserRole};
use citadel_workspace_types::{WorkspaceProtocolRequest, WorkspaceProtocolResponse};

use common::async_test_helpers::execute_command;
use common::workspace_test_utils::create_test_kernel;

// # Email and job title reach the members the sign-up form says they reach
//
// The wizard tells a new user their email and job title are "visible to
// members of this workspace". `ListMembers` strips every other member's
// metadata for a non-admin caller, so without an allowance those two fields
// would be stored and shown to nobody but admins. The avatar is kept too. Read through the dispatcher,
// as a client would, and asserted on what is STORED for the refusals.

const ALICE: &str = "alice_profile";
const BOB: &str = "bob_profile";

type Kernel = citadel_workspace_server_kernel::kernel::async_kernel::AsyncWorkspaceServerKernel<
    citadel_sdk::prelude::MonoRatchet,
>;

async fn kernel_with_two_members() -> std::sync::Arc<Kernel> {
    let kernel = create_test_kernel().await;
    for id in [ALICE, BOB] {
        kernel
            .domain_operations
            .backend_tx_manager
            .insert_user(
                id.to_string(),
                User::new(id.to_string(), id.to_string(), UserRole::Member),
            )
            .await
            .expect("insert user");
        let added = execute_command(
            &kernel,
            WorkspaceProtocolRequest::AddMember {
                user_id: id.to_string(),
                domain_id: None,
                role: UserRole::Member,
                metadata: None,
            },
        )
        .await
        .expect("dispatch");
        assert!(
            !matches!(added, WorkspaceProtocolResponse::Error(_)),
            "AddMember failed: {added:?}"
        );
    }
    kernel
}

async fn update(
    kernel: &Kernel,
    avatar: Option<&str>,
    email: Option<&str>,
    title: Option<&str>,
) -> WorkspaceProtocolResponse {
    process_command_with_user(
        kernel,
        &WorkspaceProtocolRequest::UpdateUserProfile {
            name: None,
            avatar_data: avatar.map(str::to_string),
            email: email.map(str::to_string),
            title: title.map(str::to_string),
        },
        ALICE,
    )
    .await
    .expect("dispatch")
}

fn text(user: &User, key: &str) -> Option<String> {
    match user.metadata.get(key) {
        Some(MetadataValue::String(s)) => Some(s.clone()),
        _ => None,
    }
}

async fn stored(kernel: &Kernel) -> User {
    kernel
        .domain_operations
        .backend_tx_manager
        .get_user(ALICE)
        .await
        .expect("read user")
        .expect("user exists")
}

async fn alice_as_bob_sees_her(kernel: &Kernel) -> User {
    let listed = process_command_with_user(
        kernel,
        &WorkspaceProtocolRequest::ListMembers { domain_id: None },
        BOB,
    )
    .await
    .expect("dispatch");
    let WorkspaceProtocolResponse::Members { members, .. } = listed else {
        panic!("expected Members, got {listed:?}");
    };
    members
        .into_iter()
        .find(|m| m.id == ALICE)
        .expect("alice is listed")
}

#[tokio::test]
async fn another_member_sees_avatar_email_and_title() {
    let kernel = kernel_with_two_members().await;
    let response = update(
        &kernel,
        Some("AAAA"),
        Some("alice@example.com"),
        Some("Engineer"),
    )
    .await;
    assert!(
        matches!(response, WorkspaceProtocolResponse::UserProfileUpdated(_)),
        "refused: {response:?}"
    );

    let seen = alice_as_bob_sees_her(&kernel).await;
    assert_eq!(text(&seen, "email").as_deref(), Some("alice@example.com"));
    assert_eq!(text(&seen, "title").as_deref(), Some("Engineer"));
    assert_eq!(
        text(&seen, "avatar").as_deref(),
        Some("AAAA"),
        "other members must see the avatar"
    );
    assert!(
        seen.permissions.is_empty(),
        "the permission map must stay redacted"
    );
}

#[tokio::test]
async fn an_empty_string_clears_a_stored_field() {
    let kernel = kernel_with_two_members().await;
    update(&kernel, None, Some("alice@example.com"), Some("Engineer")).await;
    let response = update(&kernel, None, Some(""), None).await;
    assert!(
        matches!(response, WorkspaceProtocolResponse::UserProfileUpdated(_)),
        "refused: {response:?}"
    );
    let user = stored(&kernel).await;
    assert_eq!(text(&user, "email"), None, "the email was not cleared");
    assert_eq!(
        text(&user, "title").as_deref(),
        Some("Engineer"),
        "an absent title must be left alone"
    );
}

#[tokio::test]
async fn a_refused_update_stores_none_of_its_fields() {
    let kernel = kernel_with_two_members().await;
    for (label, email, title) in [
        (
            "misshapen email",
            "not-an-email".to_string(),
            "Engineer".to_string(),
        ),
        (
            "long email",
            format!("{}@b", "a".repeat(254)),
            "Engineer".to_string(),
        ),
        (
            "long title",
            "alice@example.com".to_string(),
            "t".repeat(65),
        ),
    ] {
        let response = update(&kernel, None, Some(&email), Some(&title)).await;
        assert!(
            matches!(response, WorkspaceProtocolResponse::Error(_)),
            "{label} accepted: {response:?}"
        );
        let user = stored(&kernel).await;
        assert_eq!(text(&user, "email"), None, "{label}: email written anyway");
        assert_eq!(text(&user, "title"), None, "{label}: title written anyway");
    }
}

// # A placeholder display name is repaired from the registered full name
//
// Records created before the connect handler read the SDK's full name carry
// the username as `name`. The repair runs on connect; asserted here on storage,
// and the end-to-end path in the_display_name_is_the_registered_full_name.rs.

#[tokio::test]
async fn a_placeholder_name_is_repaired_and_a_chosen_one_is_kept() {
    use citadel_workspace_server_kernel::kernel::display_name::repair_placeholder_name;
    let kernel = kernel_with_two_members().await;
    let backend = &kernel.domain_operations.backend_tx_manager;

    assert!(
        repair_placeholder_name(backend, ALICE, Some("Alice Anders"))
            .await
            .expect("repair")
    );
    assert_eq!(stored(&kernel).await.name, "Alice Anders");

    let renamed = process_command_with_user(
        &kernel,
        &WorkspaceProtocolRequest::UpdateUserProfile {
            name: Some("Ali".to_string()),
            avatar_data: None,
            email: None,
            title: None,
        },
        ALICE,
    )
    .await
    .expect("dispatch");
    assert!(matches!(
        renamed,
        WorkspaceProtocolResponse::UserProfileUpdated(_)
    ));
    assert!(
        !repair_placeholder_name(backend, ALICE, Some("Alice Anders"))
            .await
            .expect("repair")
    );
    assert_eq!(
        stored(&kernel).await.name,
        "Ali",
        "a chosen name was replaced"
    );

    assert!(!repair_placeholder_name(backend, "nobody", Some("No One"))
        .await
        .expect("an absent record is not an error"));
}
