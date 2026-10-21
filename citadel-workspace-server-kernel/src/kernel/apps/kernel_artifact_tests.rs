//! Installing through the kernel: the artifact must be the one the manifest names, from an
//! upload or a fetch, and a server that cannot fetch says so.

use super::test_manifests::*;
use super::test_support::{apps_keys, ask, workspace};
use citadel_workspace_types::apps::{Capability, InstallScope};
use citadel_workspace_types::apps_install::AppsRefusal;
use citadel_workspace_types::apps_responses::AppsResponse;

const CANVAS_NODES: &[Capability] = &[Capability::Canvas, Capability::NodesRead];

#[tokio::test]
async fn fetched_bytes_must_hash_to_the_manifest_and_a_server_without_a_fetcher_says_so() {
    let (key, bytes, spec) = (publisher(1), wasm(1, 4096), Spec::new("1.0.0"));
    let request = || {
        install_request(
            &spec,
            &key,
            signed(&spec, &key, &bytes),
            InstallScope::Workspace,
            CANVAS_NODES,
            false,
        )
    };
    let kernel = workspace_serving(wasm(2, 4096)).await;
    assert_eq!(
        refused(&ask(&kernel, "inst", request()).await),
        Some(&AppsRefusal::ArtifactMismatch)
    );
    let kernel = workspace().await;
    assert_eq!(
        refused(&ask(&kernel, "inst", request()).await),
        Some(&AppsRefusal::ServerFeatureUnavailable)
    );
    let kernel = workspace_serving(bytes.clone()).await;
    assert!(installed(&ask(&kernel, "inst", request()).await));
    let stored = apps_keys(&kernel);
    let sha = hex::encode(citadel_app_signature::sha256(&bytes));
    assert!(stored.contains_key(&format!("citadel_workspace.apps.artifact.{sha}")));
}

#[tokio::test]
async fn an_upload_whose_bytes_are_not_its_digest_is_refused() {
    let kernel = workspace().await;
    let bytes = wasm(1, 4096);
    let claimed = hex::encode(citadel_app_signature::sha256(&wasm(2, 4096)));
    let request = citadel_workspace_types::apps_protocol::AppsRequest::UploadArtifactChunk {
        sha256: claimed,
        index: 0,
        total_chunks: 1,
        bytes: bytes.clone(),
    };
    assert_eq!(
        refused(&ask(&kernel, "alice", request).await),
        Some(&AppsRefusal::ArtifactMismatch)
    );
    assert!(matches!(
        upload(&kernel, "alice", &bytes).await,
        AppsResponse::ArtifactChunkStored { .. }
    ));
    let empty = citadel_workspace_types::apps_protocol::AppsRequest::UploadArtifactChunk {
        sha256: hex::encode(citadel_app_signature::sha256(&[])),
        index: 0,
        total_chunks: 1,
        bytes: vec![],
    };
    assert!(matches!(
        refused(&ask(&kernel, "alice", empty).await),
        Some(AppsRefusal::Limit(_))
    ));
}

#[tokio::test]
async fn an_artifact_over_one_chunk_is_uploaded_and_stored_in_chunks() {
    let (key, bytes, spec) = (publisher(1), wasm(1, 600 * 1024), Spec::new("1.0.0"));
    let kernel = workspace().await;
    assert!(matches!(
        upload(&kernel, "inst", &bytes).await,
        AppsResponse::ArtifactChunkStored { index: 2, .. }
    ));
    let request = install_request(
        &spec,
        &key,
        signed(&spec, &key, &bytes),
        InstallScope::Workspace,
        CANVAS_NODES,
        false,
    );
    assert!(installed(&ask(&kernel, "inst", request).await));
    let stored = apps_keys(&kernel);
    let sha = hex::encode(citadel_app_signature::sha256(&bytes));
    let chunk = |n: u32| stored.get(&format!("citadel_workspace.apps.artifact_chunk.{sha}.{n}"));
    assert!(
        chunk(2).is_some() && chunk(3).is_none(),
        "600 KiB is three chunks"
    );
    assert!((0..3).all(|n| chunk(n).is_some_and(|v| v.len() < 2_000_000)));
}
