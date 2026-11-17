//! A node's chat files count toward the workspace's storage, and stop counting when they go: when
//! the last message sharing one is deleted, and when the node is deleted.
//!
//! The workspace's storage here holds exactly one file, so whether a second fits says whether
//! the first is still counted.

use citadel_sdk::prelude::StorageQuota;
use citadel_workspace_types::chat_attachments::ChatAttachmentRefusal;
use citadel_workspace_types::{WorkspaceProtocolRequest, WorkspaceProtocolResponse};
use common::chat_attachment_test_utils::*;

mod common {
    pub use ::common::*;
}

const MEMBER_: (&str, u64) = (MEMBER, MEMBER_CID);
const SECOND_: (&str, u64) = (SECOND, SECOND_CID);
const SIZE: usize = 1000;

async fn one_file_of_room() -> std::sync::Arc<common::member_test_utils::GateKernel> {
    rooms(StorageQuota::Bytes(SIZE as u64)).await
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_file_counts_toward_the_workspaces_storage() {
    let kernel = one_file_of_room().await;
    assert!(is_stored(
        &upload(&kernel, MEMBER_, ROOM_ID, &file(SIZE, 1)).await
    ));
    let second = upload(&kernel, MEMBER_, OTHER_ROOM, &file(SIZE, 2)).await;
    assert_eq!(refusal(second), ChatAttachmentRefusal::StorageFull);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_same_file_again_is_decided_as_if_it_were_new() {
    // Otherwise a member at the limit could learn whether a node holds some file.
    let kernel = one_file_of_room().await;
    let whole = file(SIZE, 1);
    upload(&kernel, MEMBER_, ROOM_ID, &whole).await;
    assert_eq!(
        refusal(upload(&kernel, SECOND_, ROOM_ID, &whole).await),
        ChatAttachmentRefusal::StorageFull
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn deleting_the_last_share_deletes_the_file() {
    let kernel = one_file_of_room().await;
    let whole = file(SIZE, 1);
    upload(&kernel, MEMBER_, ROOM_ID, &whole).await;
    let message = share(&kernel, MEMBER_, CHANNEL, &whole)
        .await
        .expect("shared");
    delete_message(&kernel, MEMBER_, &message).await;
    assert_eq!(
        read(&kernel, MEMBER_, ROOM_ID, &id_of(&whole)).await,
        Err(ChatAttachmentRefusal::Denied)
    );
    assert!(
        is_stored(&upload(&kernel, MEMBER_, OTHER_ROOM, &file(SIZE, 2)).await),
        "its storage was not freed"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_file_another_message_still_shares_stays() {
    let kernel = rooms(StorageQuota::Unlimited).await;
    let whole = file(SIZE, 1);
    upload(&kernel, MEMBER_, ROOM_ID, &whole).await;
    let first = share(&kernel, MEMBER_, CHANNEL, &whole)
        .await
        .expect("shared");
    share(&kernel, MEMBER_, CHANNEL, &whole)
        .await
        .expect("shared again");
    delete_message(&kernel, MEMBER_, &first).await;
    assert_eq!(
        read(&kernel, SECOND_, ROOM_ID, &id_of(&whole)).await,
        Ok(whole)
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn deleting_the_node_deletes_its_files_and_frees_their_storage() {
    let kernel = one_file_of_room().await;
    let whole = file(SIZE, 1);
    upload(&kernel, MEMBER_, ROOM_ID, &whole).await;
    share(&kernel, MEMBER_, CHANNEL, &whole)
        .await
        .expect("shared");
    let request = WorkspaceProtocolRequest::DeleteNode {
        node_id: ROOM_ID.to_string(),
        cascade: true,
    };
    let deleted = ask(
        &kernel,
        common::workspace_test_utils::TEST_ADMIN_USER_ID,
        1,
        request,
    )
    .await;
    assert!(
        !matches!(deleted, WorkspaceProtocolResponse::Error(_)),
        "{deleted:?}"
    );
    assert!(
        is_stored(&upload(&kernel, MEMBER_, OTHER_ROOM, &file(SIZE, 2)).await),
        "its storage was not freed"
    );

    // A node made again under the same id holds nothing of the old one's.
    add_room_with_chat(&kernel, &[MEMBER, SECOND]).await;
    assert_eq!(
        read(&kernel, MEMBER_, ROOM_ID, &id_of(&whole)).await,
        Err(ChatAttachmentRefusal::Denied)
    );
}
