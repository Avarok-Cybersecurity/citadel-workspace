//! An upload nobody shares does not hold the workspace's storage indefinitely: the host's timed
//! sweep (`sweep_chat_attachments`, run hourly by the native server and a hosted tenant's alarm)
//! reclaims it once its grace has passed, even when nobody uploads to its node again. Each pass
//! visits a bounded number of nodes, continuing where the last one stopped.
//!
//! The workspace's storage holds exactly the files a test says, so whether another fits says
//! whether the swept one is still counted.

use citadel_sdk::prelude::StorageQuota;
use citadel_workspace_server_kernel::kernel::chat_attachment_sweep::SWEEP_BATCH;
use citadel_workspace_server_kernel::kernel::chat_attachments::UNSHARED_GRACE_MS;
use citadel_workspace_types::chat_attachments::ChatAttachmentRefusal;
use common::chat_attachment_test_utils::*;

mod common {
    pub use ::common::*;
}

const MEMBER_: (&str, u64) = (MEMBER, MEMBER_CID);
const SECOND_: (&str, u64) = (SECOND, SECOND_CID);
const SIZE: usize = 1000;

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("after 1970")
        .as_millis() as u64
}

/// Past the grace of anything uploaded before it was called.
fn after_the_grace() -> u64 {
    now_ms() + UNSHARED_GRACE_MS + 60_000
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_unshared_upload_is_swept_once_its_grace_has_passed() {
    let kernel = rooms(StorageQuota::Bytes(SIZE as u64)).await;
    let whole = file(SIZE, 1);
    assert!(is_stored(&upload(&kernel, MEMBER_, ROOM_ID, &whole).await));

    let left = kernel.sweep_chat_attachments(now_ms(), SWEEP_BATCH).await;
    assert_eq!(left.expect("swept"), 0);
    assert_eq!(
        read(&kernel, MEMBER_, ROOM_ID, &id_of(&whole)).await,
        Ok(whole.clone()),
        "within its grace an upload stays"
    );

    kernel
        .sweep_chat_attachments(after_the_grace(), SWEEP_BATCH)
        .await
        .expect("swept");
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
async fn a_shared_file_is_never_swept() {
    let kernel = rooms(StorageQuota::Unlimited).await;
    let whole = file(SIZE, 1);
    upload(&kernel, MEMBER_, ROOM_ID, &whole).await;
    share(&kernel, MEMBER_, CHANNEL, &whole)
        .await
        .expect("shared");
    kernel
        .sweep_chat_attachments(after_the_grace(), SWEEP_BATCH)
        .await
        .expect("swept");
    assert_eq!(
        read(&kernel, SECOND_, ROOM_ID, &id_of(&whole)).await,
        Ok(whole)
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn each_pass_visits_a_bounded_number_of_nodes_and_the_next_carries_on() {
    let kernel = rooms(StorageQuota::Unlimited).await;
    let (first, second) = (file(SIZE, 1), file(SIZE, 2));
    upload(&kernel, MEMBER_, ROOM_ID, &first).await;
    upload(&kernel, MEMBER_, OTHER_ROOM, &second).await;
    let later = after_the_grace();
    let held = |node: &'static str, whole: Vec<u8>| {
        let kernel = kernel.clone();
        async move { read(&kernel, MEMBER_, node, &id_of(&whole)).await.is_ok() }
    };

    assert_eq!(
        kernel
            .sweep_chat_attachments(later, 1)
            .await
            .expect("swept"),
        1
    );
    let after_one = [
        held(ROOM_ID, first.clone()).await,
        held(OTHER_ROOM, second.clone()).await,
    ];
    assert_eq!(
        after_one.iter().filter(|held| **held).count(),
        1,
        "one pass of one node swept exactly one: {after_one:?}"
    );

    assert_eq!(
        kernel
            .sweep_chat_attachments(later, 1)
            .await
            .expect("swept"),
        0
    );
    assert!(!held(ROOM_ID, first).await && !held(OTHER_ROOM, second).await);
}
