//! A document's updates come back in the order the server numbered them, a page at a time.
//!
//! The relay is the only ordering two collaborators share: each client applies the log in `seq`
//! order, so a pull that skipped, repeated or reordered an update would leave two readers
//! holding different documents with no error anywhere.

use citadel_workspace_types::documents::{DocumentsRequest, DocumentsResponse};
use common::documents_test_utils::*;
use common::workspace_test_utils::TEST_ADMIN_USER_ID;

#[tokio::test]
async fn appends_are_numbered_from_one_and_pulled_back_in_order() {
    let kernel = documents_kernel().await;
    let node = document_node(&kernel).await;

    let mut seqs = Vec::new();
    for body in [b"alpha".as_slice(), b"beta", b"gamma"] {
        seqs.push(append(&kernel, TEST_ADMIN_USER_ID, 7, &node, body).await);
    }
    assert_eq!(seqs, vec![1, 2, 3]);

    let all = pull(&kernel, TEST_ADMIN_USER_ID, &node, 0).await;
    assert_eq!(
        pulled(&all),
        vec![b"alpha".to_vec(), b"beta".to_vec(), b"gamma".to_vec()]
    );
    let DocumentsResponse::Updates {
        updates,
        snapshot,
        has_more,
        latest_seq,
        ..
    } = all
    else {
        unreachable!("pulled() checked the variant")
    };
    assert_eq!(
        updates.iter().map(|u| u.seq).collect::<Vec<_>>(),
        vec![1, 2, 3]
    );
    assert!(updates
        .iter()
        .all(|u| u.author_cid == 7 && u.doc_version == 1));
    assert_eq!((snapshot, has_more, latest_seq), (None, false, 3));
}

#[tokio::test]
async fn a_pull_returns_only_what_follows_the_readers_state() {
    let kernel = documents_kernel().await;
    let node = document_node(&kernel).await;
    for body in [b"one".as_slice(), b"two", b"three", b"four"] {
        append(&kernel, TEST_ADMIN_USER_ID, 7, &node, body).await;
    }

    let tail = pull(&kernel, TEST_ADMIN_USER_ID, &node, 2).await;
    assert_eq!(pulled(&tail), vec![b"three".to_vec(), b"four".to_vec()]);

    let current = pull(&kernel, TEST_ADMIN_USER_ID, &node, 4).await;
    assert!(
        pulled(&current).is_empty(),
        "a current reader was sent updates it holds"
    );
}

#[tokio::test]
async fn the_appender_learns_which_of_its_updates_was_stored() {
    let kernel = documents_kernel().await;
    let node = document_node(&kernel).await;
    let request = DocumentsRequest::Append {
        node_id: node.clone(),
        doc_version: 3,
        update: b"x".to_vec(),
        client_seq: 41,
    };
    let answer = documents(send(&kernel, TEST_ADMIN_USER_ID, 7, request).await);
    assert!(
        matches!(
            answer,
            DocumentsResponse::Appended {
                seq: 1,
                client_seq: 41,
                ..
            }
        ),
        "the client cannot match the acknowledgement to its update: {answer:?}"
    );
}

#[tokio::test]
async fn a_long_log_is_paged_at_the_configured_size() {
    let limits = shipped_documents_config();
    let page = u64::from(limits.max_updates_per_pull);
    let kernel = documents_kernel().await;
    let node = document_node(&kernel).await;
    let total = page * 2 + 3;
    for i in 0..total {
        append(&kernel, TEST_ADMIN_USER_ID, 7, &node, &i.to_be_bytes()).await;
    }

    let mut since = 0;
    let mut pages = 0;
    let mut seen = Vec::new();
    loop {
        let DocumentsResponse::Updates {
            updates, has_more, ..
        } = pull(&kernel, TEST_ADMIN_USER_ID, &node, since).await
        else {
            panic!("expected Updates");
        };
        assert!(
            updates.len() as u64 <= page,
            "a page held {} updates",
            updates.len()
        );
        pages += 1;
        since = updates.last().map(|u| u.seq).unwrap_or(since);
        seen.extend(updates.into_iter().map(|u| u.seq));
        if !has_more {
            break;
        }
    }
    assert_eq!(pages, 3);
    assert_eq!(
        seen,
        (1..=total).collect::<Vec<_>>(),
        "paging lost or repeated an update"
    );
}
