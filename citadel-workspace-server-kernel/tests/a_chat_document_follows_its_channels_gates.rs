//! A document shared in a node's chat is chat content: whoever may send in the channel may write
//! it, whoever may read the channel may read it, and nobody else learns it exists.
//!
//! The page's gates (`EditMdx`, `ViewContent` on the node) are the wrong question for it: a
//! member who may post in a room but not edit its page must still be able to edit a document
//! they made in its chat, and a node whose chat is off has no chat to share one in.

use citadel_workspace_types::documents::{DocumentRefusal, DocumentsResponse};
use citadel_workspace_types::structs::Permission;
use common::chat_document_test_utils::*;

mod common {
    pub use ::common::*;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_member_who_may_not_edit_the_page_writes_the_chat_document() {
    let kernel = room().await;
    let update = Replica::new(70).typed("agenda");
    chat_append(&kernel, DOC_A, &update).await;
    assert_eq!(chat_updates(&kernel, DOC_A).await, vec![update]);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_guest_reads_it_and_may_not_write_it() {
    let kernel = room().await;
    let update = Replica::new(70).typed("agenda");
    chat_append(&kernel, DOC_A, &update).await;

    let write = Replica::new(71).typed("mine");
    let answer = ask_chat(&kernel, GUEST, GUEST_CID, DOC_A, append_of(&write)).await;
    assert!(
        denied(answer, DOC_A, Permission::SendMessages),
        "a guest wrote"
    );
    let read = chat_answer(
        ask_chat(&kernel, GUEST, GUEST_CID, DOC_A, pull_all()).await,
        DOC_A,
    );
    assert!(
        matches!(&read, DocumentsResponse::Updates { updates, .. } if updates.len() == 1),
        "a guest could not read what the channel shows them: {read:?}"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_account_outside_the_room_may_neither_read_nor_write() {
    let kernel = room().await;
    chat_append(&kernel, DOC_A, &Replica::new(70).typed("agenda")).await;
    let read = ask_chat(&kernel, OUTSIDER, OUTSIDER_CID, DOC_A, pull_all()).await;
    assert!(
        denied(read, DOC_A, Permission::ViewContent),
        "an outsider read it"
    );
    let write = Replica::new(72).typed("x");
    let answer = ask_chat(&kernel, OUTSIDER, OUTSIDER_CID, DOC_A, append_of(&write)).await;
    assert!(
        denied(answer, DOC_A, Permission::SendMessages),
        "an outsider wrote"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_node_with_its_chat_off_has_none_and_says_so_as_it_says_no_node() {
    let kernel = room().await;
    let backend = &kernel.domain_operations.backend_tx_manager;
    let mut node = backend
        .get_all_nodes()
        .await
        .expect("read nodes")
        .remove(ROOM_ID)
        .expect("the room");
    node.chat_enabled = false;
    backend
        .insert_node(ROOM_ID.to_string(), node)
        .await
        .expect("save");
    let update = Replica::new(70).typed("agenda");
    let off = ask_chat(&kernel, MEMBER, MEMBER_CID, DOC_A, append_of(&update)).await;
    assert!(
        denied(off.clone(), DOC_A, Permission::SendMessages),
        "{off:?}"
    );

    let mut elsewhere = append_of(&update);
    if let citadel_workspace_types::documents::DocumentsRequest::Append { node_id, .. } =
        &mut elsewhere
    {
        *node_id = "no-such-node".to_string();
    }
    let missing = ask_chat(&kernel, MEMBER, MEMBER_CID, DOC_A, elsewhere).await;
    let (DocumentsResponse::Refused(off), DocumentsResponse::Refused(missing)) =
        (chat_answer(off, DOC_A), chat_answer(missing, DOC_A))
    else {
        panic!("both are refusals");
    };
    let without_node = |r: DocumentRefusal| match r {
        DocumentRefusal::ChatDocumentDenied { permission, .. } => permission,
        other => panic!("{other:?}"),
    };
    assert_eq!(without_node(off), without_node(missing));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn only_an_id_the_chat_makes_names_a_document() {
    let kernel = room().await;
    for id in [
        "",
        "../../documents/room-under-test",
        "cdoc-not-a-uuid",
        "3f2a9c1e-7b4d-4e8a-9f01-2c3d4e5f6a7b",
    ] {
        let answer = ask_chat(&kernel, MEMBER, MEMBER_CID, id, pull_all()).await;
        assert!(
            matches!(
                chat_answer(answer, id),
                DocumentsResponse::Refused(DocumentRefusal::ChatDocumentIdInvalid { .. })
            ),
            "{id:?} was taken for a chat document"
        );
    }
}
