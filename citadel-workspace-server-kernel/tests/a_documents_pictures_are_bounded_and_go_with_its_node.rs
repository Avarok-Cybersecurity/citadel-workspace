//! What a document's pictures may be, and how long they stay: only bytes that are their id, no
//! larger than the server keeps, no more per document than it keeps, within the workspace's
//! storage, and until the node they belong to is deleted, which frees what they counted.

use citadel_sdk::prelude::StorageQuota;
use citadel_workspace_server_kernel::kernel::chat_attachments::ChatAttachmentLimits;
use citadel_workspace_types::document_pictures::DocumentPictureRefusal as Refusal;
use citadel_workspace_types::{WorkspaceProtocolRequest, WorkspaceProtocolResponse};
use common::document_picture_test_utils::*;

mod common {
    pub use ::common::*;
}

const MEMBER_: (&str, u64) = (MEMBER, MEMBER_CID);
const SIZE: usize = 1000;

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn bytes_that_are_not_their_id_are_not_kept() {
    let kernel = rooms(StorageQuota::Unlimited).await;
    let doc = chat_doc(ROOM_ID, DOC_A);
    let (whole, named) = (file(100, 7), content_id(&file(100, 8)));
    let answer = chunk(&kernel, MEMBER_, &doc, &named, &whole, 0).await;
    assert_eq!(refusal(answer), Refusal::Mismatch);
    assert_eq!(
        read(&kernel, MEMBER_, &doc, &named).await,
        Err(Refusal::NotFound)
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_picture_over_the_configured_size_is_refused_before_a_chunk_is_kept() {
    let kernel = rooms(StorageQuota::Unlimited).await;
    let max_bytes = shipped_limits().max_bytes;
    let whole = file(max_bytes as usize + 1, 9);
    let doc = chat_doc(ROOM_ID, DOC_A);
    let answer = chunk(&kernel, MEMBER_, &doc, &content_id(&whole), &whole, 0).await;
    assert_eq!(refusal(answer), Refusal::TooLarge { max_bytes });
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_document_keeps_no_more_pictures_than_the_server_is_configured_for() {
    let limits = ChatAttachmentLimits {
        max_files_per_node: 1,
        ..shipped_limits()
    };
    let kernel = rooms_with(StorageQuota::Unlimited, limits).await;
    let doc = chat_doc(ROOM_ID, DOC_A);
    let first = file(100, 1);
    assert!(is_stored(&upload(&kernel, MEMBER_, &doc, &first).await));
    assert_eq!(
        refusal(upload(&kernel, MEMBER_, &doc, &file(100, 2)).await),
        Refusal::DocumentFull { max_pictures: 1 }
    );
    assert!(
        is_stored(&upload(&kernel, MEMBER_, &doc, &first).await),
        "storing a picture the document holds is refused"
    );
    assert!(
        is_stored(&upload(&kernel, MEMBER_, &chat_doc(ROOM_ID, DOC_B), &file(100, 2)).await),
        "the limit is per document"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn deleting_the_node_deletes_its_documents_pictures_and_frees_their_storage() {
    // Room for exactly two pictures: whether two more fit says whether both were freed.
    let kernel = rooms(StorageQuota::Bytes(2 * SIZE as u64)).await;
    grant(
        &kernel,
        MEMBER,
        ROOM_ID,
        citadel_workspace_types::structs::Permission::EditMdx,
    )
    .await;
    let (on_page, in_chat) = (file(SIZE, 1), file(SIZE, 2));
    assert!(is_stored(
        &upload(&kernel, MEMBER_, &page(ROOM_ID), &on_page).await
    ));
    assert!(is_stored(
        &upload(&kernel, MEMBER_, &chat_doc(ROOM_ID, DOC_A), &in_chat).await
    ));
    let elsewhere = chat_doc(OTHER_ROOM, DOC_A);
    assert_eq!(
        refusal(upload(&kernel, MEMBER_, &elsewhere, &file(SIZE, 3)).await),
        Refusal::StorageFull,
        "pictures do not count toward the workspace's storage"
    );

    let request = WorkspaceProtocolRequest::DeleteNode {
        node_id: ROOM_ID.to_string(),
        cascade: true,
    };
    let admin = common::workspace_test_utils::TEST_ADMIN_USER_ID;
    let deleted = ask(&kernel, admin, 1, request).await;
    assert!(
        !matches!(deleted, WorkspaceProtocolResponse::Error(_)),
        "{deleted:?}"
    );
    assert!(
        is_stored(&upload(&kernel, MEMBER_, &elsewhere, &file(SIZE, 3)).await),
        "the storage was not freed"
    );
    assert!(
        is_stored(
            &upload(
                &kernel,
                MEMBER_,
                &chat_doc(OTHER_ROOM, DOC_B),
                &file(SIZE, 4)
            )
            .await
        ),
        "the storage of one of the deleted node's documents was not freed"
    );

    // A node made again under the same id holds nothing of the old one's.
    add_room_with_chat(&kernel, &[MEMBER, SECOND, GUEST]).await;
    assert_eq!(
        read(
            &kernel,
            MEMBER_,
            &chat_doc(ROOM_ID, DOC_A),
            &content_id(&in_chat)
        )
        .await,
        Err(Refusal::NotFound)
    );
    assert_eq!(
        read(
            &kernel,
            (GUEST, GUEST_CID),
            &page(ROOM_ID),
            &content_id(&on_page)
        )
        .await,
        Err(Refusal::NotFound)
    );
}
