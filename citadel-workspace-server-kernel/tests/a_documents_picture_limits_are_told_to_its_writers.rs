//! A member who may add pictures to a document is told the limits the server keeps them to, the
//! same limits an upload is refused by, so a picture too large is refused before any of it is
//! sent. Nobody else is told: asking is gated as writing the document is.

use citadel_sdk::prelude::StorageQuota;
use citadel_workspace_types::document_pictures::{
    DocumentPictureRefusal as Refusal, DocumentPicturesRequest, DocumentPicturesResponse,
    PictureDocument,
};
use citadel_workspace_types::structs::Permission;
use common::document_picture_test_utils::*;

mod common {
    pub use ::common::*;
}

const MEMBER_: (&str, u64) = (MEMBER, MEMBER_CID);
const GUEST_: (&str, u64) = (GUEST, GUEST_CID);

async fn limits_of(
    kernel: &common::member_test_utils::GateKernel,
    who: (&str, u64),
    doc: &PictureDocument,
) -> DocumentPicturesResponse {
    send(
        kernel,
        who,
        DocumentPicturesRequest::Limits { doc: doc.clone() },
    )
    .await
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_writer_is_told_the_limits_an_upload_is_held_to() {
    let kernel = rooms(StorageQuota::Unlimited).await;
    grant(&kernel, MEMBER, ROOM_ID, Permission::EditMdx).await;
    let limits = shipped_limits();
    for doc in [page(ROOM_ID), chat_doc(ROOM_ID, DOC_A)] {
        assert_eq!(
            limits_of(&kernel, MEMBER_, &doc).await,
            DocumentPicturesResponse::Limits {
                doc: doc.clone(),
                max_bytes: limits.max_bytes,
                max_pictures: limits.max_files_per_node,
            }
        );
        let over = file(limits.max_bytes as usize + 1, 3);
        assert_eq!(
            refusal(chunk(&kernel, MEMBER_, &doc, &content_id(&over), &over, 0).await),
            Refusal::TooLarge {
                max_bytes: limits.max_bytes
            },
            "the limit told is not the one an upload is refused by"
        );
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_member_who_may_not_write_the_document_is_not_told() {
    let kernel = rooms(StorageQuota::Unlimited).await;
    for doc in [page(ROOM_ID), chat_doc(ROOM_ID, DOC_A)] {
        assert_eq!(
            refusal(limits_of(&kernel, GUEST_, &doc).await),
            Refusal::Denied
        );
    }
}
