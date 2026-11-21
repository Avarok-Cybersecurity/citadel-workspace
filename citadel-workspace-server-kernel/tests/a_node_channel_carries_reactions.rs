//! A node channel's messages carry reactions, as the direct chat's always have.
//!
//! The workspace server had no request for them, so the node chat hid the control. Now a
//! member's reaction is stored on the message, returned with the history, and refused for
//! someone who may not write to the channel.

use citadel_workspace_types::group_chat::GroupReaction;
use citadel_workspace_types::{WorkspaceProtocolRequest, WorkspaceProtocolResponse};
use common::group_channel_test_utils::*;
use common::roles_fixture::{GUEST_ROLE_ID, MEMBER_ROLE_ID};
use common::workspace_test_utils::create_test_kernel;

mod common {
    pub use ::common::*;
}

const MEMBER: &str = "room_member";
const GUEST: &str = "room_guest";
const MEMBER_CID: u64 = 101;
const GUEST_CID: u64 = 202;

fn react(message_id: &str, emoji: &str, on: bool) -> WorkspaceProtocolRequest {
    WorkspaceProtocolRequest::ReactGroupMessage {
        group_id: CHANNEL.to_string(),
        message_id: message_id.to_string(),
        emoji: emoji.to_string(),
        on,
    }
}

async fn room() -> (std::sync::Arc<Kernel>, String) {
    let kernel = create_test_kernel().await;
    add_user_with_role(&kernel, MEMBER, MEMBER_ROLE_ID).await;
    add_user_with_role(&kernel, GUEST, GUEST_ROLE_ID).await;
    add_room_with_chat(&kernel, &[MEMBER, GUEST]).await;
    let id = post(&kernel, MEMBER, MEMBER_CID).await;
    (kernel, id)
}

async fn stored_reactions(kernel: &Kernel) -> Vec<GroupReaction> {
    match ask(kernel, MEMBER, MEMBER_CID, history()).await {
        WorkspaceProtocolResponse::GroupMessages { messages, .. } => messages[0].reactions.clone(),
        other => panic!("history was refused: {other:?}"),
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_reaction_is_stored_on_the_message_and_returned_with_history() {
    let (kernel, id) = room().await;
    let answer = ask(&kernel, MEMBER, MEMBER_CID, react(&id, "👍", true)).await;
    assert!(
        matches!(
            answer,
            WorkspaceProtocolResponse::GroupMessageReacted { .. }
        ),
        "refused: {answer:?}"
    );

    let reactions = stored_reactions(&kernel).await;
    assert_eq!(reactions.len(), 1);
    assert_eq!(
        (
            reactions[0].emoji.as_str(),
            reactions[0].reactor_cid,
            reactions[0].active
        ),
        ("👍", MEMBER_CID, true)
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_retraction_is_kept_as_inactive() {
    let (kernel, id) = room().await;
    ask(&kernel, MEMBER, MEMBER_CID, react(&id, "🎉", true)).await;
    ask(&kernel, MEMBER, MEMBER_CID, react(&id, "🎉", false)).await;
    let reactions = stored_reactions(&kernel).await;
    assert_eq!(reactions.len(), 1);
    assert!(!reactions[0].active);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_guest_who_may_not_write_may_not_react() {
    let (kernel, id) = room().await;
    let answer = ask(&kernel, GUEST, GUEST_CID, react(&id, "👍", true)).await;
    assert!(
        is_denied(&answer),
        "a Guest, who may only read, reacted: {answer:?}"
    );
    assert!(stored_reactions(&kernel).await.is_empty());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_emoji_outside_the_set_is_refused_and_not_stored() {
    let (kernel, id) = room().await;
    let answer = ask(&kernel, MEMBER, MEMBER_CID, react(&id, "<img src=x>", true)).await;
    assert!(
        matches!(answer, WorkspaceProtocolResponse::Error(_)),
        "stored an arbitrary string: {answer:?}"
    );
    assert!(stored_reactions(&kernel).await.is_empty());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_reaction_to_no_message_is_refused() {
    let (kernel, _) = room().await;
    let answer = ask(
        &kernel,
        MEMBER,
        MEMBER_CID,
        react("no-such-message", "👍", true),
    )
    .await;
    assert!(
        matches!(answer, WorkspaceProtocolResponse::Error(ref e) if e == "Message not found"),
        "{answer:?}"
    );
}
