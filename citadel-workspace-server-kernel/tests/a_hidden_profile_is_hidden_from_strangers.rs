use citadel_workspace_server_kernel::kernel::command_processor::async_process_command::process_command_with_user;
use citadel_workspace_types::structs::{MetadataValue, User, UserRole};
use citadel_workspace_types::{WorkspaceProtocolRequest, WorkspaceProtocolResponse};

use common::async_test_helpers::execute_command;
use common::workspace_test_utils::{create_test_kernel, TEST_ADMIN_USER_ID};

// # "Profile Visibility: off" is enforced by the server that serves the profile
//
// The avatar, email and title are stored on the workspace server and served to
// every member by `ListMembers` (and to admins by `GetMember`). A client that
// declines to render them has not stopped anybody reading them, so the switch
// only means something if the SERVER leaves them out.
//
// The test kernel has no SDK account store, so no P2P registration exists and
// every other member is a stranger -- the case this file is about. The contact
// case is covered by `profile_visibility`'s unit tests, where the relationship
// is an input.

const ALICE: &str = "alice_hidden";
const BOB: &str = "bob_stranger";

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

async fn alice_sets(kernel: &Kernel, show: Option<bool>, accepts: Option<bool>) {
    let response = process_command_with_user(
        kernel,
        &WorkspaceProtocolRequest::UpdateUserProfile {
            name: None,
            avatar_data: Some("AAAA".to_string()),
            email: Some("alice@example.com".to_string()),
            title: Some("Engineer".to_string()),
            show_profile_to_strangers: show,
            accepts_requests_from_strangers: accepts,
        },
        ALICE,
    )
    .await
    .expect("dispatch");
    assert!(
        matches!(response, WorkspaceProtocolResponse::UserProfileUpdated(_)),
        "refused: {response:?}"
    );
}

async fn alice_as_listed_to(kernel: &Kernel, viewer: &str) -> User {
    let listed = process_command_with_user(
        kernel,
        &WorkspaceProtocolRequest::ListMembers { domain_id: None },
        viewer,
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

fn has(user: &User, key: &str) -> bool {
    user.metadata.contains_key(key)
}

const DETAILS: [&str; 3] = ["avatar", "email", "title"];

#[tokio::test]
async fn a_stranger_is_not_sent_a_hidden_profile() {
    let kernel = kernel_with_two_members().await;
    alice_sets(&kernel, Some(false), None).await;

    let seen = alice_as_listed_to(&kernel, BOB).await;
    for key in DETAILS {
        assert!(!has(&seen, key), "{key} reached a stranger: {seen:?}");
    }
    assert_eq!(seen.name, ALICE, "the roster itself must still list her");
}

#[tokio::test]
async fn a_shown_profile_still_reaches_other_members() {
    // Discrimination: without it the test above passes against a server that
    // strips every profile from everyone.
    let kernel = kernel_with_two_members().await;
    alice_sets(&kernel, Some(true), None).await;

    let seen = alice_as_listed_to(&kernel, BOB).await;
    for key in DETAILS {
        assert!(
            has(&seen, key),
            "{key} was withheld although shown: {seen:?}"
        );
    }
}

#[tokio::test]
async fn the_owner_still_sees_her_own_hidden_profile() {
    let kernel = kernel_with_two_members().await;
    alice_sets(&kernel, Some(false), None).await;

    let seen = alice_as_listed_to(&kernel, ALICE).await;
    for key in DETAILS {
        assert!(has(&seen, key), "{key} was withheld from its owner");
    }
}

#[tokio::test]
async fn an_admin_who_is_not_a_contact_is_not_sent_it_either() {
    let kernel = kernel_with_two_members().await;
    alice_sets(&kernel, Some(false), None).await;

    let listed = alice_as_listed_to(&kernel, TEST_ADMIN_USER_ID).await;
    let fetched = match execute_command(
        &kernel,
        WorkspaceProtocolRequest::GetMember {
            user_id: ALICE.to_string(),
        },
    )
    .await
    .expect("dispatch")
    {
        WorkspaceProtocolResponse::Member(user) => user,
        other => panic!("expected Member, got {other:?}"),
    };
    for key in DETAILS {
        assert!(!has(&listed, key), "{key} reached an admin via ListMembers");
        assert!(!has(&fetched, key), "{key} reached an admin via GetMember");
    }
}

#[tokio::test]
async fn the_request_policy_is_readable_by_the_people_it_refuses() {
    let kernel = kernel_with_two_members().await;
    alice_sets(&kernel, Some(false), Some(false)).await;

    let seen = alice_as_listed_to(&kernel, BOB).await;
    assert_eq!(
        seen.metadata.get("accepts_requests_from_strangers"),
        Some(&MetadataValue::Boolean(false)),
        "a refused requester could not be told why"
    );
}
