use super::chat_attachments::*;
use citadel_workspace_types::chat_attachments::ChatAttachmentRefusal;
use std::collections::BTreeMap;

const A: &str = "aa";
const NOW: u64 = 10_000_000;
/// Above any number of files these tests make, so only `a_node_holds_at_most_its_limit` meets it.
const ROOMY: u32 = 64;

fn uploaded(by: &str) -> AttachmentIndex {
    let mut index = AttachmentIndex::default();
    index.record_upload(A, 5, by, NOW, ROOMY).expect("room");
    index
}

#[test]
fn an_unshared_upload_is_its_uploaders_alone() {
    let index = uploaded("alice");
    assert!(index.readable_by(A, "alice").is_some());
    assert!(index.readable_by(A, "bob").is_none());
}

#[test]
fn a_shared_file_is_the_channels() {
    let mut index = uploaded("alice");
    assert!(index.claim(A, 5, "alice", "m1"));
    assert!(index.readable_by(A, "bob").is_some());
}

#[test]
fn only_its_uploader_at_its_size_may_share_it() {
    let mut index = uploaded("alice");
    assert!(!index.claim(A, 5, "bob", "m1"), "someone else's upload");
    assert!(!index.claim(A, 6, "alice", "m1"), "another size");
    assert!(!index.claim("bb", 5, "alice", "m1"), "a file not here");
    assert!(index.files[A].messages.is_empty());
}

#[test]
fn the_last_share_deleted_drops_the_file() {
    let mut index = uploaded("alice");
    index.record_upload(A, 5, "bob", NOW, ROOMY).expect("room");
    assert!(index.claim(A, 5, "alice", "m1"));
    assert!(index.claim(A, 5, "bob", "m2"));
    assert_eq!(index.release(A, "m1"), None, "m2 still shares it");
    assert_eq!(
        index.release(A, "m9"),
        None,
        "a message that never shared it"
    );
    assert_eq!(index.release(A, "m2"), Some(5));
    assert!(index.files.is_empty());
}

#[test]
fn an_upload_nobody_shares_goes_stale() {
    let mut index = uploaded("alice");
    index
        .record_upload("bb", 7, "alice", NOW, ROOMY)
        .expect("room");
    assert!(index.claim("bb", 7, "alice", "m1"));
    assert!(index.stale(NOW + UNSHARED_GRACE_MS).is_empty());
    assert_eq!(
        index.stale(NOW + UNSHARED_GRACE_MS + 1),
        vec![(A.to_string(), 5)]
    );
}

#[test]
fn a_node_holds_at_most_its_limit() {
    const LIMIT: u32 = 3;
    let mut index = AttachmentIndex::default();
    for n in 0..LIMIT {
        index
            .record_upload(&format!("{n:064x}"), 1, "alice", NOW, LIMIT)
            .expect("under the limit");
    }
    assert_eq!(
        index.record_upload("new", 1, "alice", NOW, LIMIT),
        Err(ChatAttachmentRefusal::NodeFull { max_files: LIMIT })
    );
    assert_eq!(
        index.record_upload(&format!("{:064x}", 0), 1, "bob", NOW, LIMIT),
        Ok(())
    );
}

#[test]
fn a_share_whose_message_was_not_stored_is_taken_back_and_the_upload_kept() {
    let mut index = uploaded("alice");
    assert!(index.claim(A, 5, "alice", "m1"));
    index.unclaim(A, "m1");
    assert!(index.files[A].messages.is_empty());
    assert!(index.readable_by(A, "bob").is_none(), "unshared again");
    assert!(index.readable_by(A, "alice").is_some(), "still uploaded");
}

#[test]
fn the_sweep_drops_stale_uploads_and_bytes_the_index_never_named() {
    let mut index = uploaded("alice");
    index
        .record_upload("bb", 7, "alice", NOW, ROOMY)
        .expect("room");
    assert!(index.claim("bb", 7, "alice", "m1"));
    index
        .record_upload("cc", 3, "alice", NOW, ROOMY)
        .expect("room");
    let ledger = BTreeMap::from([
        (A.to_string(), 5),
        ("bb".to_string(), 7),
        ("orphan".to_string(), 9),
    ]);
    let plan = index.sweep(&ledger, NOW + UNSHARED_GRACE_MS + 1);
    assert_eq!(
        plan.drop,
        vec![(A.to_string(), 5), ("orphan".to_string(), 9)],
        "the stale upload and the bytes a failed store left"
    );
    assert_eq!(
        plan.forget,
        vec![A.to_string(), "cc".to_string()],
        "the stale entry, and an entry whose bytes the ledger does not hold"
    );
    assert!(index.sweep(&ledger, NOW).drop == vec![("orphan".to_string(), 9)]);
}

#[test]
fn no_app_id_can_name_the_chat_root() {
    assert!(citadel_app_id::validate_app_id(CHAT_ATTACHMENTS_ROOT).is_err());
}
