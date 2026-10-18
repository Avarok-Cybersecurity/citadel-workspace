//! A document update, and every awareness payload, reaches the sessions that may read the node
//! and no other.
//!
//! The update IS the document: a session that receives one it may not `Pull` has read the
//! document. So each assertion asks the same question the per-connection forwarding loop asks
//! (`may_receive`) of the broadcast the relay actually sent, for a reader, a non-member and a
//! banned member.

use citadel_workspace_server_kernel::kernel::async_kernel::BroadcastMessage;
use citadel_workspace_types::documents::{DocumentsRequest, DocumentsResponse};
use citadel_workspace_types::structs::UserRole;
use citadel_workspace_types::WorkspaceProtocolResponse;
use common::documents_test_utils::*;
use common::member_test_utils::{insert_user_with_role, join_root, GateKernel};
use common::workspace_test_utils::TEST_ADMIN_USER_ID;

const AUTHOR_CID: u64 = 7;

/// A reader, an account that is not a member, and a member who has been banned.
async fn audience(kernel: &GateKernel) {
    reader(kernel, "reader").await;
    insert_user_with_role(kernel, "stranger", UserRole::Member).await;
    insert_user_with_role(kernel, "banned", UserRole::Banned).await;
    join_root(kernel, "banned").await;
}

fn documents_broadcast(seen: Vec<BroadcastMessage>) -> BroadcastMessage {
    let mut documents: Vec<BroadcastMessage> = seen
        .into_iter()
        .filter(|m| matches!(m.response, WorkspaceProtocolResponse::Documents(_)))
        .collect();
    assert_eq!(
        documents.len(),
        1,
        "expected exactly one documents broadcast"
    );
    documents.remove(0)
}

async fn reaches(kernel: &GateKernel, msg: &BroadcastMessage, user: &str) -> bool {
    kernel.may_receive(user, &msg.audience).await
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_update_reaches_readers_and_never_anyone_else() {
    let kernel = documents_kernel().await;
    let node = document_node(&kernel).await;
    audience(&kernel).await;
    let mut rx = kernel.subscribe_broadcast();

    let hello = Replica::new(70).typed("hello");
    let seq = append(&kernel, TEST_ADMIN_USER_ID, AUTHOR_CID, &node, &hello).await;

    let msg = documents_broadcast(drain(&mut rx).await);
    let WorkspaceProtocolResponse::Documents(DocumentsResponse::DocumentUpdated {
        node_id,
        seq: announced,
        update,
        author_cid,
        ..
    }) = &msg.response
    else {
        panic!("expected DocumentUpdated, got {:?}", msg.response);
    };
    assert_eq!(
        (node_id, *announced, update.as_slice(), *author_cid),
        (&node, seq, hello.as_slice(), AUTHOR_CID)
    );
    assert_eq!(
        msg.exclude_cid,
        Some(AUTHOR_CID),
        "the author was sent its own update"
    );

    assert!(
        reaches(&kernel, &msg, "reader").await,
        "a reader did not receive the update"
    );
    assert!(
        !reaches(&kernel, &msg, "stranger").await,
        "a non-member received the document"
    );
    assert!(
        !reaches(&kernel, &msg, "banned").await,
        "a banned member received the document"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn awareness_is_relayed_to_readers_and_never_stored() {
    let kernel = documents_kernel().await;
    let node = document_node(&kernel).await;
    audience(&kernel).await;
    let mut rx = kernel.subscribe_broadcast();

    let request = DocumentsRequest::Awareness {
        node_id: node.clone(),
        payload: b"cursor@12".to_vec(),
    };
    let answer = documents(send(&kernel, "reader", 9, request).await);
    assert!(
        matches!(answer, DocumentsResponse::AwarenessRelayed { .. }),
        "{answer:?}"
    );

    let msg = documents_broadcast(drain(&mut rx).await);
    assert!(
        matches!(
            &msg.response,
            WorkspaceProtocolResponse::Documents(DocumentsResponse::DocumentAwareness { from_cid: 9, payload, .. })
                if payload.as_slice() == b"cursor@12"
        ),
        "expected the payload relayed from cid 9, got {:?}",
        msg.response
    );
    assert_eq!(msg.exclude_cid, Some(9));
    assert!(reaches(&kernel, &msg, TEST_ADMIN_USER_ID).await);
    assert!(
        !reaches(&kernel, &msg, "stranger").await,
        "a non-member saw a reader's cursor"
    );
    assert!(
        !reaches(&kernel, &msg, "banned").await,
        "a banned member saw a reader's cursor"
    );

    let DocumentsResponse::Updates {
        updates,
        latest_seq,
        snapshot,
        ..
    } = pull(&kernel, TEST_ADMIN_USER_ID, &node, 0).await
    else {
        panic!("expected Updates");
    };
    assert!(
        updates.is_empty() && snapshot.is_none(),
        "awareness reached the log"
    );
    assert_eq!(latest_seq, 0);
}

#[tokio::test]
async fn non_readers_cannot_pull_or_be_present() {
    let kernel = documents_kernel().await;
    let node = document_node(&kernel).await;
    audience(&kernel).await;
    let secret = Replica::new(70).typed("secret");
    append(&kernel, TEST_ADMIN_USER_ID, AUTHOR_CID, &node, &secret).await;

    for user in ["stranger", "banned"] {
        let pulled = send(
            &kernel,
            user,
            11,
            DocumentsRequest::Pull {
                node_id: node.clone(),
                since_seq: 0,
            },
        )
        .await;
        assert!(
            matches!(&pulled, WorkspaceProtocolResponse::Error(e) if e.contains("ViewContent")),
            "{user} was answered {pulled:?}"
        );
        let present = send(
            &kernel,
            user,
            11,
            DocumentsRequest::Awareness {
                node_id: node.clone(),
                payload: vec![1],
            },
        )
        .await;
        assert!(
            matches!(&present, WorkspaceProtocolResponse::Error(e) if e.contains("ViewContent")),
            "{user} was answered {present:?}"
        );
    }
}
