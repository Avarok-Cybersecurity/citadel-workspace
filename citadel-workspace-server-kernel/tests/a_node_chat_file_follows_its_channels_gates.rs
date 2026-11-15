//! A file shared in a node's chat is chat content, kept on the workspace server: whoever may send
//! in the channel may upload one, whoever may read the channel reads it once a message shares it,
//! and nobody else learns it exists. A share names only a file its sender uploaded to that node.

use citadel_sdk::prelude::StorageQuota;
use citadel_workspace_types::chat_attachments::ChatAttachmentRefusal;
use common::chat_attachment_test_utils::*;

mod common {
    pub use ::common::*;
}

const MEMBER_: (&str, u64) = (MEMBER, MEMBER_CID);
const SECOND_: (&str, u64) = (SECOND, SECOND_CID);
const GUEST_: (&str, u64) = (GUEST, GUEST_CID);
const OUTSIDER_: (&str, u64) = (OUTSIDER, OUTSIDER_CID);

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_shared_file_reads_back_whole_for_every_reader_of_the_channel() {
    let kernel = rooms(StorageQuota::Unlimited).await;
    // Three chunks, the last short: the file is put together from all of them.
    let whole = file(2 * 256 * 1024 + 77, 1);
    assert!(is_stored(&upload(&kernel, MEMBER_, ROOM_ID, &whole).await));
    share(&kernel, MEMBER_, CHANNEL, &whole)
        .await
        .expect("shared");
    assert_eq!(
        read(&kernel, GUEST_, ROOM_ID, &id_of(&whole)).await,
        Ok(whole.clone())
    );
    assert_eq!(
        read(&kernel, SECOND_, ROOM_ID, &id_of(&whole)).await,
        Ok(whole)
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_account_outside_the_room_cannot_read_it() {
    let kernel = rooms(StorageQuota::Unlimited).await;
    let whole = file(100, 2);
    upload(&kernel, MEMBER_, ROOM_ID, &whole).await;
    share(&kernel, MEMBER_, CHANNEL, &whole)
        .await
        .expect("shared");
    let outside = read(&kernel, OUTSIDER_, ROOM_ID, &id_of(&whole)).await;
    let no_such = read(&kernel, OUTSIDER_, "no-such-node", &id_of(&whole)).await;
    assert_eq!(outside, Err(ChatAttachmentRefusal::Denied));
    assert_eq!(outside, no_such, "the refusal says whether the node exists");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_member_who_may_not_send_cannot_upload() {
    let kernel = rooms(StorageQuota::Unlimited).await;
    let whole = file(100, 3);
    let answer = upload(&kernel, GUEST_, ROOM_ID, &whole).await;
    assert_eq!(refusal(answer), ChatAttachmentRefusal::Denied);
    assert_eq!(
        read(&kernel, GUEST_, ROOM_ID, &id_of(&whole)).await,
        Err(ChatAttachmentRefusal::Denied)
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_upload_nobody_shared_is_its_uploaders_alone() {
    let kernel = rooms(StorageQuota::Unlimited).await;
    let whole = file(100, 4);
    upload(&kernel, MEMBER_, ROOM_ID, &whole).await;
    assert_eq!(
        read(&kernel, MEMBER_, ROOM_ID, &id_of(&whole)).await,
        Ok(whole.clone())
    );
    assert_eq!(
        read(&kernel, SECOND_, ROOM_ID, &id_of(&whole)).await,
        Err(ChatAttachmentRefusal::Denied)
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_share_of_another_uploaders_file_is_refused() {
    let kernel = rooms(StorageQuota::Unlimited).await;
    let whole = file(100, 5);
    upload(&kernel, MEMBER_, ROOM_ID, &whole).await;
    let refused = share(&kernel, SECOND_, CHANNEL, &whole).await;
    assert!(refused.is_err(), "{refused:?}");
    assert_eq!(
        read(&kernel, SECOND_, ROOM_ID, &id_of(&whole)).await,
        Err(ChatAttachmentRefusal::Denied),
        "the refused share opened it"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_share_of_another_channels_file_is_refused() {
    let kernel = rooms(StorageQuota::Unlimited).await;
    let whole = file(100, 6);
    upload(&kernel, MEMBER_, OTHER_ROOM, &whole).await;
    let refused = share(&kernel, MEMBER_, CHANNEL, &whole).await;
    assert!(refused.is_err(), "{refused:?}");
    share(&kernel, MEMBER_, OTHER_CHANNEL, &whole)
        .await
        .expect("shared where it was uploaded");
    assert_eq!(
        read(&kernel, SECOND_, ROOM_ID, &id_of(&whole)).await,
        Err(ChatAttachmentRefusal::Denied)
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn bytes_that_are_not_their_id_are_not_kept() {
    let kernel = rooms(StorageQuota::Unlimited).await;
    let whole = file(100, 7);
    let answer = chunk(&kernel, MEMBER_, ROOM_ID, &id_of(&file(100, 8)), &whole, 0).await;
    assert_eq!(refusal(answer), ChatAttachmentRefusal::Mismatch);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_file_over_the_configured_size_is_refused_before_a_chunk_is_kept() {
    let kernel = rooms(StorageQuota::Unlimited).await;
    let max_bytes = shipped_max_bytes();
    let whole = file(max_bytes as usize + 1, 9);
    let answer = chunk(&kernel, MEMBER_, ROOM_ID, &id_of(&whole), &whole, 0).await;
    assert_eq!(
        refusal(answer),
        ChatAttachmentRefusal::TooLarge { max_bytes }
    );
}
