//! A CRDT client id belongs, on a document, to the author that first wrote as it.
//!
//! Every replica attributes an operation to the client id it carries, and resolves concurrent
//! marks and attributes by it. An editor who could write as another's client id could forge
//! their edits, or overwrite their formatting with operations that seem to be theirs.

use citadel_workspace_types::documents::{DocumentRefusal, DocumentsRequest, DocumentsResponse};
use common::documents_test_utils::*;
use common::workspace_test_utils::TEST_ADMIN_USER_ID;

const ALICE_CID: u64 = 7;
const BOB_CID: u64 = 8;
const ALICES_CLIENT: u64 = 70;

fn append_request(node: &str, update: Vec<u8>) -> DocumentsRequest {
    DocumentsRequest::Append {
        node_id: node.to_string(),
        doc_version: 1,
        update,
        client_seq: 1,
    }
}

async fn latest_seq(kernel: &common::member_test_utils::GateKernel, node: &str) -> u64 {
    match pull(kernel, TEST_ADMIN_USER_ID, node, 0).await {
        DocumentsResponse::Updates { latest_seq, .. } => latest_seq,
        other => panic!("expected Updates, got {other:?}"),
    }
}

#[tokio::test]
async fn bob_cannot_append_as_alices_client_id() {
    let kernel = documents_kernel().await;
    let node = document_node(&kernel).await;
    writer(&kernel, "bob", &node).await;
    let mut alice = Replica::new(ALICES_CLIENT);
    append(
        &kernel,
        TEST_ADMIN_USER_ID,
        ALICE_CID,
        &node,
        &alice.typed("mine"),
    )
    .await;

    let mut forger = Replica::new(ALICES_CLIENT);
    forger.absorb(&alice.typed(" still mine"));
    let forged = forger.typed(" forged");
    let answer = documents(send(&kernel, "bob", BOB_CID, append_request(&node, forged)).await);
    assert_eq!(
        answer,
        DocumentsResponse::Refused(DocumentRefusal::ClientIdForeign {
            node_id: node.clone(),
            crdt_client: ALICES_CLIENT,
        })
    );
    assert_eq!(
        latest_seq(&kernel, &node).await,
        1,
        "the forgery was stored"
    );

    let bobs_own = Replica::new(ALICES_CLIENT + 1).typed("bob");
    assert_eq!(append(&kernel, "bob", BOB_CID, &node, &bobs_own).await, 2);
    // Alice goes on writing as her own client.
    assert_eq!(
        append(
            &kernel,
            TEST_ADMIN_USER_ID,
            ALICE_CID,
            &node,
            &alice.typed("!")
        )
        .await,
        3
    );
}

#[tokio::test]
async fn no_one_writes_as_the_blank_documents_client() {
    let kernel = documents_kernel().await;
    let node = document_node(&kernel).await;
    let answer = documents(
        send(
            &kernel,
            TEST_ADMIN_USER_ID,
            ALICE_CID,
            append_request(&node, update_as_blank_client()),
        )
        .await,
    );
    assert_eq!(
        answer,
        DocumentsResponse::Refused(DocumentRefusal::ClientIdReserved {
            node_id: node.clone()
        })
    );
    assert_eq!(latest_seq(&kernel, &node).await, 0);
}
