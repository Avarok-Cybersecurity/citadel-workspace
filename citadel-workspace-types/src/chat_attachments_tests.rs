use crate::chat_attachments::*;

const ID: &str = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";
const FULL: usize = CHAT_ATTACHMENT_CHUNK_BYTES as usize;

#[test]
fn a_file_in_full_chunks_and_a_short_last_one_fits() {
    let size = (FULL * 2 + 10) as u64;
    assert_eq!(check_upload_chunk(ID, size, 0, 3, FULL), Ok(()));
    assert_eq!(check_upload_chunk(ID, size, 1, 3, FULL), Ok(()));
    assert_eq!(check_upload_chunk(ID, size, 2, 3, 10), Ok(()));
}

#[test]
fn a_chunk_that_does_not_fit_its_file_is_refused() {
    let size = (FULL + 10) as u64;
    let bad = Err(ChatAttachmentRefusal::BadChunk);
    assert_eq!(
        check_upload_chunk(ID, size, 0, 2, FULL - 1),
        bad,
        "short middle chunk"
    );
    assert_eq!(
        check_upload_chunk(ID, size, 1, 2, 11),
        bad,
        "last chunk past the size"
    );
    assert_eq!(
        check_upload_chunk(ID, size, 2, 2, 10),
        bad,
        "index past the last"
    );
    assert_eq!(
        check_upload_chunk(ID, size, 0, 3, FULL),
        bad,
        "a total the size does not make"
    );
    assert_eq!(check_upload_chunk(ID, 0, 0, 0, 0), bad, "an empty file");
    assert_eq!(
        check_upload_chunk("../x", 10, 0, 1, 10),
        bad,
        "an id that is no digest"
    );
}

#[test]
fn only_a_lowercase_sha256_is_an_id() {
    assert!(is_attachment_id(ID));
    assert!(!is_attachment_id(&ID.to_uppercase()));
    assert!(!is_attachment_id(&ID[1..]));
    assert!(!is_attachment_id(
        "cdoc-3f2a9c1e-7b4d-4e8a-9f01-2c3d4e5f6a7b"
    ));
}

#[test]
fn a_share_names_a_file_and_a_type() {
    assert_eq!(
        share_fields_refusal("report v2.pdf", "application/pdf"),
        None
    );
    assert_eq!(share_fields_refusal("photo.jpg", "image/jpeg"), None);
    for name in [
        "",
        "  ",
        "../../etc/passwd",
        "a\\b",
        "bell\u{7}.txt",
        &"x".repeat(256),
    ] {
        assert!(
            share_fields_refusal(name, "text/plain").is_some(),
            "{name:?}"
        );
    }
    for mime in [
        "",
        "pdf",
        "text/",
        "/plain",
        "text/plain; charset=utf-8",
        "a/b/c",
    ] {
        assert!(share_fields_refusal("a.txt", mime).is_some(), "{mime:?}");
    }
}
