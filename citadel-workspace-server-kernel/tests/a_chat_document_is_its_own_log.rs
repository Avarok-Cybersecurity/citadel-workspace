//! Each document shared in a node's chat is a log of its own: not the node's page, not another
//! chat document, announced to the channel's readers under its own id, and deleted with the node.

use citadel_workspace_server_kernel::handlers::domain::node_ops::AsyncNodeOperations;
use citadel_workspace_server_kernel::kernel::async_kernel::BroadcastAudience;
use citadel_workspace_types::chat_documents::ChatDocumentsResponse;
use citadel_workspace_types::documents::{DocumentRefusal, DocumentsRequest, DocumentsResponse};
use citadel_workspace_types::WorkspaceProtocolResponse;
use common::chat_document_test_utils::*;
use common::documents_test_utils::{append, pull, pulled};
use common::workspace_test_utils::TEST_ADMIN_USER_ID;

mod common {
    pub use ::common::*;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_page_and_two_chat_documents_never_share_an_update() {
    let kernel = room().await;
    let page = Replica::new(60).typed("page");
    let a = Replica::new(70).typed("a");
    let b = Replica::new(80).typed("b");
    append(&kernel, TEST_ADMIN_USER_ID, 9, ROOM_ID, &page).await;
    assert_eq!(
        chat_append(&kernel, DOC_A, &a).await,
        1,
        "a chat document numbers from 1"
    );
    chat_append(&kernel, DOC_B, &b).await;

    assert_eq!(
        pulled(&pull(&kernel, TEST_ADMIN_USER_ID, ROOM_ID, 0).await),
        vec![page]
    );
    assert_eq!(chat_updates(&kernel, DOC_A).await, vec![a]);
    assert_eq!(chat_updates(&kernel, DOC_B).await, vec![b]);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_update_is_announced_to_the_channel_under_its_id() {
    let kernel = room().await;
    let mut rx = kernel.subscribe_broadcast();
    let a = Replica::new(70).typed("a");
    chat_append(&kernel, DOC_A, &a).await;

    let seen: Vec<_> = drain(&mut rx)
        .await
        .into_iter()
        .filter(|m| {
            matches!(
                m.response,
                WorkspaceProtocolResponse::ChatDocuments(_)
                    | WorkspaceProtocolResponse::Documents(_)
            )
        })
        .collect();
    assert_eq!(seen.len(), 1, "expected one push: {seen:?}");
    let push = &seen[0];
    let WorkspaceProtocolResponse::ChatDocuments(ChatDocumentsResponse {
        chat_doc,
        answer: DocumentsResponse::DocumentUpdated { update, .. },
    }) = &push.response
    else {
        panic!("not a chat document's update: {:?}", push.response);
    };
    assert_eq!((chat_doc.as_str(), update), (DOC_A, &a));
    assert!(matches!(&push.audience, BroadcastAudience::Group(c) if c == CHANNEL));
    assert!(
        kernel.may_receive(GUEST, &push.audience).await,
        "a reader missed it"
    );
    assert!(
        !kernel.may_receive(OUTSIDER, &push.audience).await,
        "an outsider got it"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_refusal_names_the_document_it_refuses() {
    let kernel = room().await;
    let answer = ask_chat(
        &kernel,
        MEMBER,
        MEMBER_CID,
        DOC_A,
        append_of(b"not a crdt update"),
    )
    .await;
    assert!(matches!(
        chat_answer(answer, DOC_A),
        DocumentsResponse::Refused(DocumentRefusal::UpdateMalformed { .. })
    ));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn deleting_the_node_deletes_its_chat_documents() {
    let kernel = room().await;
    chat_append(&kernel, DOC_A, &Replica::new(70).typed("a")).await;
    chat_append(&kernel, DOC_B, &Replica::new(80).typed("b")).await;
    kernel
        .domain_operations
        .delete_node(TEST_ADMIN_USER_ID, ROOM_ID, false)
        .await
        .expect("delete");

    // The same room, ids and all: a log that outlived its node would be read straight back.
    add_room_with_chat(&kernel, &[MEMBER, GUEST]).await;
    for doc in [DOC_A, DOC_B] {
        assert!(
            chat_updates(&kernel, doc).await.is_empty(),
            "{doc} outlived its node"
        );
    }
    let whole = DocumentsRequest::Pull {
        node_id: ROOM_ID.to_string(),
        since_seq: 0,
    };
    let answer = chat_answer(
        ask_chat(&kernel, MEMBER, MEMBER_CID, DOC_A, whole).await,
        DOC_A,
    );
    assert!(matches!(
        answer,
        DocumentsResponse::Updates {
            latest_seq: 0,
            snapshot: None,
            ..
        }
    ));
}
