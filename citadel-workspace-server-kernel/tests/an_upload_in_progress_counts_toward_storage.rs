//! A member's chat upload in progress is counted toward the workspace's storage from its first
//! chunk, so staged bytes cannot exceed what the workspace may hold: every member stages at most
//! one upload, and together they are admitted against the same storage as the files kept.

use citadel_sdk::prelude::StorageQuota;
use citadel_workspace_types::chat_attachments::{
    ChatAttachmentRefusal, CHAT_ATTACHMENT_CHUNK_BYTES,
};
use common::chat_attachment_test_utils::*;

mod common {
    pub use ::common::*;
}

const MEMBER_: (&str, u64) = (MEMBER, MEMBER_CID);
const SECOND_: (&str, u64) = (SECOND, SECOND_CID);
/// Two chunks: the first chunk stages part of it, and the second completes it.
const BIG: usize = CHAT_ATTACHMENT_CHUNK_BYTES as usize + 1000;
const SMALL: usize = 1000;

/// Storage for the big file and nothing more.
async fn room_for_the_big_file() -> std::sync::Arc<common::member_test_utils::GateKernel> {
    rooms(StorageQuota::Bytes(BIG as u64)).await
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_staged_upload_holds_its_room_against_another_members_file() {
    let kernel = room_for_the_big_file().await;
    let big = file(BIG, 1);
    let started = chunk(&kernel, MEMBER_, ROOM_ID, &id_of(&big), &big, 0).await;
    assert!(!is_stored(&started), "{started:?}");
    assert_eq!(
        refusal(upload(&kernel, SECOND_, OTHER_ROOM, &file(SMALL, 2)).await),
        ChatAttachmentRefusal::StorageFull,
        "the staged upload's room was given away"
    );
    let finished = chunk(&kernel, MEMBER_, ROOM_ID, &id_of(&big), &big, 1).await;
    assert!(
        is_stored(&finished),
        "counted twice when kept: {finished:?}"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_member_s_next_upload_replaces_what_their_last_one_reserved() {
    let kernel = room_for_the_big_file().await;
    let big = file(BIG, 1);
    chunk(&kernel, MEMBER_, ROOM_ID, &id_of(&big), &big, 0).await;
    assert!(
        is_stored(&upload(&kernel, MEMBER_, ROOM_ID, &file(SMALL, 2)).await),
        "the abandoned upload still holds its room"
    );
    assert!(
        is_stored(&upload(&kernel, SECOND_, OTHER_ROOM, &file(BIG - SMALL, 3)).await),
        "the kept file's reservation was not released"
    );
}
