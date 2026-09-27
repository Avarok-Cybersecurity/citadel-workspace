//! A live document in an office or room chat is merged, numbered, relayed and kept by the server.
//!
//! Owner, 2026-09-27: Live Doc in every chat context, "server-relayed for offices/rooms". The
//! server holds each document's one merged state (`yrs`), so what is pinned here is that two
//! members' edits converge, that each accepted update is numbered and reaches the channel, that
//! nothing but a real Yjs update is stored, that an outsider can do neither, and that a document
//! goes with its office.
//!
//! No mocks: the real command processor and storage; the updates are made by a real Yjs (`yrs`).
use base64::Engine;
use citadel_workspace_server_kernel::kernel::command_processor::async_process_command::process_command_with_user;
use citadel_workspace_server_kernel::kernel::transaction::live_docs::MAX_DOCS_PER_CHANNEL;
use citadel_workspace_server_kernel::WORKSPACE_ROOT_ID;
use citadel_workspace_types::structs::{NodeEntityType, UserRole};
use citadel_workspace_types::{WorkspaceProtocolRequest, WorkspaceProtocolResponse};
use common::member_test_utils::{insert_user_with_role, GateKernel as Kernel};
use common::workspace_test_utils::{create_test_kernel, TEST_ADMIN_USER_ID};
use std::time::Duration;
use yrs::updates::decoder::Decode;
use yrs::{Doc, GetString, ReadTxn, StateVector, Text, Transact, Update};

const B64: base64::engine::GeneralPurpose = base64::engine::general_purpose::STANDARD;

async fn send(
    kernel: &Kernel,
    request: WorkspaceProtocolRequest,
    user: &str,
) -> WorkspaceProtocolResponse {
    process_command_with_user(kernel, &request, user)
        .await
        .expect("dispatch failed")
}

/// An office with its chat on, and its channel id.
async fn office(kernel: &Kernel) -> (String, String) {
    let node = match send(
        kernel,
        WorkspaceProtocolRequest::CreateNode {
            parent_id: Some(WORKSPACE_ROOT_ID.to_string()),
            entity_type: NodeEntityType::Child("Office".to_string()),
            name: "Ops".to_string(),
            description: String::new(),
        },
        TEST_ADMIN_USER_ID,
    )
    .await
    {
        WorkspaceProtocolResponse::Node(n) => n,
        other => panic!("create failed: {other:?}"),
    };
    let on = WorkspaceProtocolRequest::UpdateNode {
        node_id: node.id.clone(),
        name: None,
        description: None,
        mdx_content: None,
        rules: None,
        chat_enabled: Some(true),
        is_default: None,
    };
    match send(kernel, on, TEST_ADMIN_USER_ID).await {
        WorkspaceProtocolResponse::Node(n) => {
            (node.id, n.chat_channel_id.expect("chat on has a channel"))
        }
        other => panic!("chat on failed: {other:?}"),
    }
}

/// A Yjs update inserting `text` into the shared text "body", as a client editor would make.
fn edit(text: &str, client: u64) -> String {
    let doc = Doc::with_client_id(client);
    let body = doc.get_or_insert_text("body");
    body.insert(&mut doc.transact_mut(), 0, text);
    let encoded = doc
        .transact()
        .encode_state_as_update_v1(&StateVector::default());
    B64.encode(encoded)
}

fn update(group: &str, doc: &str, update: String) -> WorkspaceProtocolRequest {
    WorkspaceProtocolRequest::LiveDocUpdate {
        group_id: group.into(),
        doc_id: doc.into(),
        update,
    }
}

fn open(group: &str, doc: &str) -> WorkspaceProtocolRequest {
    WorkspaceProtocolRequest::LiveDocOpen {
        group_id: group.into(),
        doc_id: doc.into(),
    }
}

/// The text "body" of an opened document.
fn body_of(response: WorkspaceProtocolResponse) -> (u32, String) {
    let WorkspaceProtocolResponse::LiveDocState { seq, state, .. } = response else {
        panic!("open failed: {response:?}");
    };
    let bytes = B64.decode(&state).unwrap();
    if bytes.is_empty() {
        return (seq, String::new()); // never written
    }
    let doc = Doc::new();
    let body = doc.get_or_insert_text("body");
    doc.transact_mut()
        .apply_update(Update::decode_v1(&bytes).unwrap())
        .unwrap();
    let text = body.get_string(&doc.transact());
    (seq, text)
}

const DOC: &str = "3f2b9c1e-0d4a-4c7e-9b1a-5e6f7a8b9c0d";

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn two_members_edits_converge_numbered_and_reach_the_channel() {
    let kernel = create_test_kernel().await;
    let (_, channel) = office(&kernel).await;
    let mut rx = kernel.subscribe_broadcast();

    for (text, client, want) in [("Hello", 1, 1), (" world", 2, 2)] {
        match send(
            &kernel,
            update(&channel, DOC, edit(text, client)),
            TEST_ADMIN_USER_ID,
        )
        .await
        {
            WorkspaceProtocolResponse::LiveDocUpdated { seq, .. } => assert_eq!(seq, want),
            other => panic!("update refused: {other:?}"),
        }
    }
    let (seq, text) = body_of(send(&kernel, open(&channel, DOC), TEST_ADMIN_USER_ID).await);
    assert_eq!(seq, 2);
    assert!(
        text.contains("Hello") && text.contains("world"),
        "the edits did not merge: {text:?}"
    );

    let mut relayed = 0;
    while let Ok(Ok(msg)) = tokio::time::timeout(Duration::from_millis(200), rx.recv()).await {
        relayed += matches!(
            msg.response,
            WorkspaceProtocolResponse::LiveDocUpdated { .. }
        ) as u32;
    }
    assert_eq!(
        relayed, 2,
        "an accepted update must reach the channel's other readers"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn only_a_real_update_of_a_sane_size_is_stored() {
    let kernel = create_test_kernel().await;
    let (_, channel) = office(&kernel).await;
    let garbage = B64.encode([0xff_u8; 64]);
    let huge = edit(&"x".repeat(80 * 1024), 3);
    for bad in [garbage, huge, "not base64!".to_string()] {
        let response = send(&kernel, update(&channel, DOC, bad), TEST_ADMIN_USER_ID).await;
        assert!(
            matches!(response, WorkspaceProtocolResponse::Error(_)),
            "stored: {response:?}"
        );
    }
    assert_eq!(
        body_of(send(&kernel, open(&channel, DOC), TEST_ADMIN_USER_ID).await),
        (0, String::new())
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn someone_outside_the_channel_can_neither_read_nor_write() {
    let kernel = create_test_kernel().await;
    let (_, channel) = office(&kernel).await;
    // An account on the server that is not a member of this workspace. (A member of the
    // workspace inherits its offices, as permissions inherit Workspace → Office → Room.)
    insert_user_with_role(&kernel, "stranger", UserRole::Member).await;
    for request in [open(&channel, DOC), update(&channel, DOC, edit("x", 4))] {
        assert!(matches!(
            send(&kernel, request, "stranger").await,
            WorkspaceProtocolResponse::Error(_)
        ));
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_channel_holds_a_bounded_number_of_documents() {
    let kernel = create_test_kernel().await;
    let (_, channel) = office(&kernel).await;
    for i in 0..MAX_DOCS_PER_CHANNEL {
        let doc = format!("doc-{i}");
        assert!(matches!(
            send(
                &kernel,
                update(&channel, &doc, edit("x", 5)),
                TEST_ADMIN_USER_ID
            )
            .await,
            WorkspaceProtocolResponse::LiveDocUpdated { .. }
        ));
    }
    let over = send(
        &kernel,
        update(&channel, "one-too-many", edit("x", 5)),
        TEST_ADMIN_USER_ID,
    )
    .await;
    assert!(
        matches!(over, WorkspaceProtocolResponse::Error(_)),
        "{over:?}"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_document_goes_with_its_office() {
    let kernel = create_test_kernel().await;
    let (office_id, channel) = office(&kernel).await;
    send(
        &kernel,
        update(&channel, DOC, edit("secret", 6)),
        TEST_ADMIN_USER_ID,
    )
    .await;
    let deleted = send(
        &kernel,
        WorkspaceProtocolRequest::DeleteNode {
            node_id: office_id,
            cascade: true,
        },
        TEST_ADMIN_USER_ID,
    )
    .await;
    assert!(
        !matches!(deleted, WorkspaceProtocolResponse::Error(_)),
        "{deleted:?}"
    );
    let (seq, state) = kernel
        .domain_operations
        .backend_tx_manager
        .live_doc_state(&channel, DOC)
        .await
        .expect("read");
    assert_eq!(
        (seq, state.is_empty()),
        (0, true),
        "the deleted office's document is still stored"
    );
}

fn share(
    channel: &str,
    kind: citadel_workspace_types::GroupMessageType,
    id: Option<&str>,
    title: Option<&str>,
) -> WorkspaceProtocolRequest {
    WorkspaceProtocolRequest::SendGroupMessage {
        group_id: channel.to_string(),
        message_type: kind,
        content: "Shared a live document".to_string(),
        reply_to: None,
        mentions: None,
        document_id: id.map(str::to_string),
        document_title: title.map(str::to_string),
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_live_document_is_shared_in_the_channel_by_id_and_title() {
    use citadel_workspace_types::GroupMessageType::{LiveDocument, Text};
    let kernel = create_test_kernel().await;
    let (_, channel) = office(&kernel).await;
    match send(
        &kernel,
        share(&channel, LiveDocument, Some(DOC), Some(" Sprint plan ")),
        TEST_ADMIN_USER_ID,
    )
    .await
    {
        WorkspaceProtocolResponse::GroupMessageNotification { message, .. } => {
            assert_eq!(
                (
                    message.document_id.as_deref(),
                    message.document_title.as_deref()
                ),
                (Some(DOC), Some("Sprint plan"))
            );
        }
        other => panic!("sharing failed: {other:?}"),
    }
    for bad in [
        share(&channel, LiveDocument, None, Some("t")),
        share(&channel, LiveDocument, Some("../escape"), Some("t")),
        share(&channel, LiveDocument, Some(DOC), Some("")),
        share(&channel, Text, Some(DOC), Some("t")),
    ] {
        assert!(matches!(
            send(&kernel, bad, TEST_ADMIN_USER_ID).await,
            WorkspaceProtocolResponse::Error(_)
        ));
    }
}
