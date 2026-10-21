//! Artifacts in transit and at rest: what an uploaded chunk must be, how a module is cut into
//! stored chunks and checked against its manifest. Pure.

use citadel_app_signature::sha256;
use citadel_workspace_types::apps_install::AppsRefusal;
use citadel_workspace_types::apps_manifest::ArtifactRef;
use citadel_workspace_types::apps_manifest_check_parts::MAX_ARTIFACT_BYTES;
use citadel_workspace_types::apps_protocol::ARTIFACT_CHUNK_BYTES;

/// The most chunks an artifact of `MAX_ARTIFACT_BYTES` takes.
pub const MAX_CHUNKS: u32 = MAX_ARTIFACT_BYTES.div_ceil(ARTIFACT_CHUNK_BYTES);

pub fn is_sha256_hex(text: &str) -> bool {
    text.len() == 64 && text.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

/// One uploaded chunk: a digest, an index below a total of at most `MAX_CHUNKS`, and every
/// chunk but the last exactly `ARTIFACT_CHUNK_BYTES`.
pub fn check_upload_chunk(
    sha256: &str,
    index: u32,
    total_chunks: u32,
    len: usize,
) -> Result<(), AppsRefusal> {
    let limit = |what: &str| Err(AppsRefusal::Limit(what.to_string()));
    if !is_sha256_hex(sha256) {
        return limit("sha256 is not 64 lowercase hex characters");
    }
    if total_chunks == 0 || total_chunks > MAX_CHUNKS {
        return limit("an artifact is at most 8 MiB, in 1 MiB chunks");
    }
    if index >= total_chunks {
        return limit("the chunk index is past the last chunk");
    }
    let full = ARTIFACT_CHUNK_BYTES as usize;
    let fits = if index + 1 == total_chunks {
        (1..=full).contains(&len)
    } else {
        len == full
    };
    if !fits {
        return limit("every chunk but the last is exactly 1 MiB");
    }
    Ok(())
}

/// `bytes` if they are the module `artifact` names: its size and its digest.
pub fn check_artifact_bytes(artifact: &ArtifactRef, bytes: &[u8]) -> Result<(), AppsRefusal> {
    let size_matches = u32::try_from(bytes.len()).is_ok_and(|len| len == artifact.bytes);
    if size_matches && hex::encode(sha256(bytes)) == artifact.sha256 {
        Ok(())
    } else {
        Err(AppsRefusal::ArtifactMismatch)
    }
}

/// `bytes` cut into the chunks `FetchArtifact` serves.
pub fn chunks(bytes: &[u8]) -> impl Iterator<Item = &[u8]> {
    bytes.chunks(ARTIFACT_CHUNK_BYTES as usize)
}
