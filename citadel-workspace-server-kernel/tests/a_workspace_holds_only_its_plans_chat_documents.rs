//! A workspace holds as many chat documents as its plan allows, counted across every node (owner,
//! 2026-10-24: 50 on Free). The one past the limit is refused inside its own envelope with the
//! limit it reached, and nothing of it is stored; a document already made keeps taking updates;
//! and a node's deletion gives its documents back to the count, exactly.

use citadel_workspace_server_kernel::handlers::domain::node_ops::AsyncNodeOperations;
use citadel_workspace_types::documents::{DocumentRefusal, DocumentsResponse};
use common::chat_document_test_utils::*;
use common::workspace_test_utils::TEST_ADMIN_USER_ID;

mod common {
    pub use ::common::*;
}

/// The Free tier's count (billing/tiers.json `chat_documents`).
const FREE: u32 = 50;

/// The `n`th document id, in the chat's own shape.
fn doc(n: u64) -> String {
    format!("cdoc-00000000-0000-4000-8000-{n:012x}")
}

/// The first update of document `n`, from a session of its own (the append rate is per session).
async fn make(kernel: &GateKernel, n: u64) -> DocumentsResponse {
    let id = doc(n);
    let update = Replica::new(1_000 + n).typed("x");
    chat_answer(
        ask_chat(kernel, MEMBER, 10_000 + n, &id, append_of(&update)).await,
        &id,
    )
}

async fn fill(kernel: &GateKernel, from: u64, count: u32) {
    for n in from..from + u64::from(count) {
        let answer = make(kernel, n).await;
        assert!(
            matches!(answer, DocumentsResponse::Appended { .. }),
            "document {n} was refused: {answer:?}"
        );
    }
}

fn reached(answer: &DocumentsResponse) -> bool {
    matches!(answer, DocumentsResponse::Refused(DocumentRefusal::ChatDocumentLimitReached { node_id, limit })
        if node_id == ROOM_ID && *limit == FREE)
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_fifty_first_is_refused_and_stores_nothing() {
    let kernel = room_with_limit(FREE).await;
    fill(&kernel, 0, FREE).await;
    let refused = make(&kernel, 99).await;
    assert!(reached(&refused), "{refused:?}");
    assert!(
        chat_updates(&kernel, &doc(99)).await.is_empty(),
        "the refused document was stored"
    );
    // One already made is not a new one: it keeps taking updates at the limit.
    let more = Replica::new(5_000).typed("y");
    let again = chat_answer(
        ask_chat(&kernel, MEMBER, 10_000, &doc(0), append_of(&more)).await,
        &doc(0),
    );
    assert!(
        matches!(again, DocumentsResponse::Appended { .. }),
        "{again:?}"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_deleted_node_gives_its_documents_back_exactly() {
    let kernel = room_with_limit(FREE).await;
    fill(&kernel, 0, FREE).await;
    kernel
        .domain_operations
        .delete_node(TEST_ADMIN_USER_ID, ROOM_ID, false)
        .await
        .expect("delete");
    add_room_with_chat(&kernel, &[MEMBER, GUEST]).await;
    // Admitted again after the delete, up to the limit and not one past it: the count went back
    // to zero, not below it and not above.
    fill(&kernel, 100, FREE).await;
    assert!(reached(&make(&kernel, 199).await));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_kernel_with_no_limit_makes_no_new_document() {
    let kernel = documents_kernel().await;
    add_user_with_role(
        &kernel,
        MEMBER,
        citadel_workspace_types::structs::UserRole::Member,
    )
    .await;
    add_room_with_chat(&kernel, &[MEMBER]).await;
    let answer = make(&kernel, 1).await;
    assert!(
        matches!(
            answer,
            DocumentsResponse::Refused(DocumentRefusal::ChatDocumentLimitUnavailable { .. })
        ),
        "{answer:?}"
    );
}
