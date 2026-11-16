use crate::chat_documents::*;
use crate::documents::DocumentsRequest;
use crate::structs::Permission;

/// What `crypto.randomUUID()` gives the chat's `newChatDocumentId()`.
const MADE_BY_THE_CHAT: &str = "cdoc-3f2a9c1e-7b4d-4e8a-9f01-2c3d4e5f6a7b";

#[test]
fn the_id_the_chat_makes_is_a_chat_document_id() {
    assert!(is_chat_document_id(MADE_BY_THE_CHAT));
}

#[test]
fn anything_else_is_not() {
    let refused = [
        "",
        "cdoc-",
        // The earlier chat editor's bare UUID: a direct chat's, never a node channel's.
        "3f2a9c1e-7b4d-4e8a-9f01-2c3d4e5f6a7b",
        "cdoc-3F2A9C1E-7B4D-4E8A-9F01-2C3D4E5F6A7B",
        "cdoc-3f2a9c1e-7b4d-4e8a-9f01-2c3d4e5f6a7",
        "cdoc-3f2a9c1e-7b4d-4e8a-9f01-2c3d4e5f6a7b0",
        "cdoc-3f2a9c1e-7b4d-4e8a-9f01-2c3d4e5f6a7b-00",
        "cdoc-3f2a9c1e7b4d4e8a9f012c3d4e5f6a7b",
        "cdoc-3f2a9c1e-7b4d-4e8a-9f01-2c3d4e5f6a.b",
        "cdoc-../../3f2a9c1e-7b4d-4e8a-9f01-2c3d4e5f",
    ];
    for id in refused {
        assert!(
            !is_chat_document_id(id),
            "{id:?} was taken for a chat document id"
        );
    }
}

#[test]
fn writing_needs_what_sending_does_and_reading_what_the_channel_does() {
    let node_id = "n".to_string();
    let append = DocumentsRequest::Append {
        node_id: node_id.clone(),
        doc_version: 1,
        update: vec![],
        client_seq: 0,
    };
    let snapshot = DocumentsRequest::StoreSnapshot {
        node_id: node_id.clone(),
        doc_version: 1,
        snapshot: vec![],
        upto_seq: 1,
    };
    let pull = DocumentsRequest::Pull {
        node_id: node_id.clone(),
        since_seq: 0,
    };
    let awareness = DocumentsRequest::Awareness {
        node_id,
        payload: vec![],
    };
    assert_eq!(
        required_channel_permission(&append),
        Permission::SendMessages
    );
    assert_eq!(
        required_channel_permission(&snapshot),
        Permission::SendMessages
    );
    assert_eq!(required_channel_permission(&pull), CHANNEL_READ);
    assert_eq!(required_channel_permission(&awareness), CHANNEL_READ);
}
