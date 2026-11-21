//! A node channel knows how far each member has read, and relays who is typing.
//!
//! Read receipts in the node chat never worked: `read_by` existed only in the UI and the footer
//! always said "Sent". The server now keeps one cursor per member and returns them with the
//! history. Typing is relayed, never stored, and both are bounded per sender.

use citadel_workspace_server_kernel::kernel::command_processor::group_read_cursors::READ_CURSOR_TOO_SOON;
use citadel_workspace_server_kernel::kernel::command_processor::group_typing::TYPING_TOO_SOON;
use citadel_workspace_types::group_chat::GroupReadCursor;
use citadel_workspace_types::{WorkspaceProtocolRequest, WorkspaceProtocolResponse};
use common::group_channel_test_utils::*;
use common::roles_fixture::{GUEST_ROLE_ID, MEMBER_ROLE_ID};
use common::workspace_test_utils::create_test_kernel;

mod common {
    pub use ::common::*;
}

const MEMBER: &str = "room_member";
const GUEST: &str = "room_guest";
const OUTSIDER: &str = "not_in_this_room";
const MEMBER_CID: u64 = 101;

fn mark(upto: &str) -> WorkspaceProtocolRequest {
    WorkspaceProtocolRequest::MarkGroupRead {
        group_id: CHANNEL.to_string(),
        upto_message_id: upto.to_string(),
    }
}

fn typing() -> WorkspaceProtocolRequest {
    WorkspaceProtocolRequest::GroupTyping {
        group_id: CHANNEL.to_string(),
    }
}

async fn room() -> (std::sync::Arc<Kernel>, String) {
    let kernel = create_test_kernel().await;
    add_user_with_role(&kernel, MEMBER, MEMBER_ROLE_ID).await;
    add_user_with_role(&kernel, GUEST, GUEST_ROLE_ID).await;
    add_user_with_role(&kernel, OUTSIDER, MEMBER_ROLE_ID).await;
    add_room_with_chat(&kernel, &[MEMBER, GUEST]).await;
    let id = post(&kernel, MEMBER, MEMBER_CID).await;
    (kernel, id)
}

async fn cursors(kernel: &Kernel) -> Vec<GroupReadCursor> {
    match ask(kernel, MEMBER, MEMBER_CID, history()).await {
        WorkspaceProtocolResponse::GroupMessages { read_cursors, .. } => read_cursors,
        other => panic!("history was refused: {other:?}"),
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_members_cursor_is_kept_and_returned_with_history() {
    let (kernel, id) = room().await;
    let answer = ask(&kernel, MEMBER, MEMBER_CID, mark(&id)).await;
    assert!(
        matches!(
            answer,
            WorkspaceProtocolResponse::GroupReadCursorMoved { .. }
        ),
        "refused: {answer:?}"
    );
    assert_eq!(
        cursors(&kernel).await,
        vec![GroupReadCursor {
            member: MEMBER.to_string(),
            upto_message_id: id
        }]
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn someone_outside_the_room_cannot_move_a_cursor() {
    let (kernel, id) = room().await;
    let answer = ask(&kernel, OUTSIDER, 303, mark(&id)).await;
    assert!(is_denied(&answer), "{answer:?}");
    assert!(cursors(&kernel).await.is_empty());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_cursor_must_name_a_message_of_the_channel() {
    let (kernel, _) = room().await;
    let answer = ask(&kernel, MEMBER, MEMBER_CID, mark("no-such-message")).await;
    assert!(
        matches!(answer, WorkspaceProtocolResponse::Error(ref e) if e == "Message not found"),
        "{answer:?}"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_second_cursor_inside_a_second_is_not_recorded() {
    let (kernel, id) = room().await;
    ask(&kernel, MEMBER, MEMBER_CID, mark(&id)).await;
    let answer = ask(&kernel, MEMBER, MEMBER_CID, mark(&id)).await;
    assert!(
        matches!(answer, WorkspaceProtocolResponse::Error(ref e) if e == READ_CURSOR_TOO_SOON),
        "{answer:?}"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn deleting_the_room_takes_its_cursors() {
    let (kernel, id) = room().await;
    ask(&kernel, MEMBER, MEMBER_CID, mark(&id)).await;
    let backend = &kernel.domain_operations.backend_tx_manager;
    backend
        .delete_all_group_messages(CHANNEL)
        .await
        .expect("delete");
    assert!(backend
        .group_read_cursors(CHANNEL)
        .await
        .expect("read")
        .is_empty());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn typing_is_relayed_for_a_writer_and_bounded() {
    let (kernel, _) = room().await;
    let first = ask(&kernel, MEMBER, MEMBER_CID, typing()).await;
    assert!(
        matches!(first, WorkspaceProtocolResponse::GroupTypingNotice { ref member, .. } if member == MEMBER),
        "{first:?}"
    );
    let again = ask(&kernel, MEMBER, MEMBER_CID, typing()).await;
    assert!(
        matches!(again, WorkspaceProtocolResponse::Error(ref e) if e == TYPING_TOO_SOON),
        "{again:?}"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_guest_who_may_not_write_is_not_typing() {
    let (kernel, _) = room().await;
    assert!(is_denied(&ask(&kernel, GUEST, 202, typing()).await));
}
