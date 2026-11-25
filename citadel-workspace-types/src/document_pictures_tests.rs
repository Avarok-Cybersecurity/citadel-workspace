use crate::chat_attachments::CHAT_ATTACHMENT_CHUNK_BYTES;
use crate::chat_documents::required_channel_permission;
use crate::document_pictures::*;
use crate::documents::{self, DocumentsRequest};

const DIGEST: &str = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";
const CHAT_DOC: &str = "cdoc-3f2a9c1e-7b4d-4e8a-9f01-2c3d4e5f6a7b";

fn doc(chat_doc: Option<&str>) -> PictureDocument {
    PictureDocument {
        node_id: "n".to_string(),
        chat_doc: chat_doc.map(str::to_string),
    }
}

fn upload(doc: PictureDocument) -> DocumentPicturesRequest {
    DocumentPicturesRequest::UploadChunk {
        doc,
        content_id: format!("sha256-{DIGEST}"),
        size_bytes: 1,
        index: 0,
        total_chunks: 1,
        bytes: vec![0],
    }
}

fn read(doc: PictureDocument) -> DocumentPicturesRequest {
    DocumentPicturesRequest::ReadChunk {
        doc,
        content_id: format!("sha256-{DIGEST}"),
        index: 0,
    }
}

fn append() -> DocumentsRequest {
    DocumentsRequest::Append {
        node_id: "n".to_string(),
        doc_version: 1,
        update: vec![],
        client_seq: 0,
    }
}

fn pull() -> DocumentsRequest {
    DocumentsRequest::Pull {
        node_id: "n".to_string(),
        since_seq: 0,
    }
}

#[test]
fn a_pages_pictures_take_the_pages_gates() {
    assert_eq!(
        required_permission(&upload(doc(None))),
        documents::required_permission(&append())
    );
    assert_eq!(
        required_permission(&read(doc(None))),
        documents::required_permission(&pull())
    );
}

#[test]
fn a_chat_documents_pictures_take_the_channels_gates() {
    let chat = || doc(Some(CHAT_DOC));
    assert_eq!(
        required_permission(&upload(chat())),
        required_channel_permission(&append())
    );
    assert_eq!(
        required_permission(&read(chat())),
        required_channel_permission(&pull())
    );
}

#[test]
fn a_content_id_is_the_prefix_and_a_lowercase_sha256() {
    assert_eq!(picture_digest(&format!("sha256-{DIGEST}")), Some(DIGEST));
    for id in [
        DIGEST.to_string(),
        format!("sha256-{}", DIGEST.to_uppercase()),
        format!("sha256-{}", &DIGEST[1..]),
        format!("sha256-{DIGEST}0"),
        format!("sha512-{DIGEST}"),
        format!("sha256-../{}", &DIGEST[3..]),
    ] {
        assert_eq!(
            picture_digest(&id),
            None,
            "{id:?} was taken for a content id"
        );
    }
}

#[test]
fn a_chunk_is_shaped_as_a_chat_files_chunk_is() {
    let id = format!("sha256-{DIGEST}");
    let full = CHAT_ATTACHMENT_CHUNK_BYTES as usize;
    let size = (full + 10) as u64;
    assert_eq!(check_picture_chunk(&id, size, 0, 2, full), Ok(()));
    assert_eq!(check_picture_chunk(&id, size, 1, 2, 10), Ok(()));
    let bad = Err(DocumentPictureRefusal::BadChunk);
    assert_eq!(check_picture_chunk(&id, size, 1, 2, 11), bad);
    assert_eq!(check_picture_chunk(&id, size, 0, 3, full), bad);
    assert_eq!(check_picture_chunk(DIGEST, size, 0, 2, full), bad);
}
