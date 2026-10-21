//! What an uploaded chunk must be, on its own.

use super::artifact::*;
use citadel_workspace_types::apps_install::AppsRefusal;
use citadel_workspace_types::apps_protocol::ARTIFACT_CHUNK_BYTES;

const SHA: &str = "0000000000000000000000000000000000000000000000000000000000000000";
const FULL: usize = ARTIFACT_CHUNK_BYTES as usize;

fn limited(result: Result<(), AppsRefusal>) -> bool {
    matches!(result, Err(AppsRefusal::Limit(_)))
}

#[test]
fn an_eight_mib_artifact_is_thirty_two_chunks_of_256_kib() {
    assert_eq!(ARTIFACT_CHUNK_BYTES, 256 * 1024);
    assert_eq!(MAX_CHUNKS, 32);
    assert_eq!(check_upload_chunk(SHA, 31, 32, FULL), Ok(()));
    assert!(limited(check_upload_chunk(SHA, 0, 33, FULL)));
}

#[test]
fn every_chunk_but_the_last_is_exactly_full_and_none_is_larger() {
    assert_eq!(check_upload_chunk(SHA, 0, 2, FULL), Ok(()));
    assert_eq!(check_upload_chunk(SHA, 1, 2, 1), Ok(()));
    assert!(limited(check_upload_chunk(SHA, 0, 2, FULL - 1)));
    assert!(limited(check_upload_chunk(SHA, 1, 2, FULL + 1)));
    assert!(
        limited(check_upload_chunk(SHA, 0, 1, 1024 * 1024)),
        "the old 1 MiB chunk"
    );
}
