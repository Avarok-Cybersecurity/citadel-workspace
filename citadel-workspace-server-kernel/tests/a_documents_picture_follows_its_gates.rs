//! A picture in a document is the document's content: whoever may write the document stores it,
//! whoever may read the document reads it back whole, and nobody else learns it exists. A page
//! follows the node's `EditMdx` and `ViewContent`; a document shared in the node's chat follows
//! the channel's send and read permissions.

use citadel_sdk::prelude::StorageQuota;
use citadel_workspace_types::document_pictures::DocumentPictureRefusal as Refusal;
use citadel_workspace_types::structs::Permission;
use common::document_picture_test_utils::*;

mod common {
    pub use ::common::*;
}

const MEMBER_: (&str, u64) = (MEMBER, MEMBER_CID);
const GUEST_: (&str, u64) = (GUEST, GUEST_CID);
const OUTSIDER_: (&str, u64) = (OUTSIDER, OUTSIDER_CID);

/// The rooms, with the member granted `EditMdx` on the room's page.
async fn rooms_with_an_editor() -> std::sync::Arc<common::member_test_utils::GateKernel> {
    let kernel = rooms(StorageQuota::Unlimited).await;
    grant(&kernel, MEMBER, ROOM_ID, Permission::EditMdx).await;
    kernel
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_pages_picture_reads_back_whole_for_a_reader_of_the_page() {
    let kernel = rooms_with_an_editor().await;
    // Three chunks, the last short: the picture is put together from all of them.
    let whole = file(2 * 256 * 1024 + 77, 1);
    assert!(is_stored(
        &upload(&kernel, MEMBER_, &page(ROOM_ID), &whole).await
    ));
    assert_eq!(
        read(&kernel, GUEST_, &page(ROOM_ID), &content_id(&whole)).await,
        Ok(whole)
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_chat_documents_picture_reads_back_whole_for_a_reader_of_the_channel() {
    let kernel = rooms(StorageQuota::Unlimited).await;
    let doc = chat_doc(ROOM_ID, DOC_A);
    let whole = file(256 * 1024 + 5, 2);
    assert!(is_stored(&upload(&kernel, MEMBER_, &doc, &whole).await));
    assert_eq!(
        read(&kernel, GUEST_, &doc, &content_id(&whole)).await,
        Ok(whole.clone())
    );
    assert_eq!(
        read(
            &kernel,
            GUEST_,
            &chat_doc(ROOM_ID, DOC_B),
            &content_id(&whole)
        )
        .await,
        Err(Refusal::NotFound),
        "another chat document of the node holds its pictures"
    );
    assert_eq!(
        read(&kernel, GUEST_, &page(ROOM_ID), &content_id(&whole)).await,
        Err(Refusal::NotFound),
        "the node's page holds its chat documents' pictures"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_account_that_may_not_read_the_page_is_refused_its_pictures() {
    let kernel = rooms_with_an_editor().await;
    let whole = file(100, 3);
    upload(&kernel, MEMBER_, &page(ROOM_ID), &whole).await;
    let id = content_id(&whole);
    let outside = read(&kernel, OUTSIDER_, &page(ROOM_ID), &id).await;
    let no_such = read(&kernel, OUTSIDER_, &page("no-such-node"), &id).await;
    assert_eq!(outside, Err(Refusal::Denied));
    assert_eq!(outside, no_such, "the refusal says whether the node exists");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_account_that_may_not_read_the_channel_is_refused_its_documents_pictures() {
    let kernel = rooms(StorageQuota::Unlimited).await;
    let doc = chat_doc(ROOM_ID, DOC_A);
    let whole = file(100, 4);
    upload(&kernel, MEMBER_, &doc, &whole).await;
    let id = content_id(&whole);
    assert_eq!(
        read(&kernel, OUTSIDER_, &doc, &id).await,
        Err(Refusal::Denied)
    );
    assert_eq!(
        read(&kernel, MEMBER_, &chat_doc(ROOM_ID, "../page"), &id).await,
        Err(Refusal::Denied),
        "a chat document id that is not one was looked up"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_reader_who_may_not_edit_the_page_cannot_store_a_picture() {
    let kernel = rooms_with_an_editor().await;
    let whole = file(100, 5);
    assert_eq!(
        refusal(upload(&kernel, GUEST_, &page(ROOM_ID), &whole).await),
        Refusal::Denied
    );
    assert_eq!(
        read(&kernel, MEMBER_, &page(ROOM_ID), &content_id(&whole)).await,
        Err(Refusal::NotFound),
        "a refused upload was kept"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_member_who_may_not_send_cannot_store_a_chat_documents_picture() {
    let kernel = rooms(StorageQuota::Unlimited).await;
    let doc = chat_doc(ROOM_ID, DOC_A);
    let whole = file(100, 6);
    assert_eq!(
        refusal(upload(&kernel, GUEST_, &doc, &whole).await),
        Refusal::Denied
    );
    assert_eq!(
        read(&kernel, MEMBER_, &doc, &content_id(&whole)).await,
        Err(Refusal::NotFound),
        "a refused upload was kept"
    );
}
