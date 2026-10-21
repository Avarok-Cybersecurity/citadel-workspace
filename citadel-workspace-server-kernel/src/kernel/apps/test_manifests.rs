//! Publishers' keys, signed manifests, artifacts and their upload, and the host network the
//! fetch tests are given.

use super::test_support::{ask, workspace, Kernel};
use base64::Engine;
use citadel_app_signature::{sha256, AppSigningKey, ArtifactDigests};
use citadel_workspace_types::apps_install::{AppsRefusal, InstallState};
use citadel_workspace_types::apps_protocol::{AppsRequest, ListingOffer, ARTIFACT_CHUNK_BYTES};
use citadel_workspace_types::apps_responses::AppsResponse;
use serde_json::{json, Value};
use std::collections::HashMap;

pub(crate) fn publisher(seed: u8) -> AppSigningKey {
    AppSigningKey::from_seed(&[seed; 32])
}

/// A small module: its bytes are its identity, so each `n` is a different artifact.
pub(crate) fn wasm(n: u8, len: usize) -> Vec<u8> {
    let mut bytes = b"\0asm\x01\0\0\0".to_vec();
    bytes.resize(len, n);
    bytes
}

/// The parts of a manifest the tests vary.
pub(crate) struct Spec {
    pub id: &'static str,
    pub version: &'static str,
    pub audience: Value,
    pub capabilities: Value,
}

impl Spec {
    pub fn new(version: &'static str) -> Self {
        Self {
            id: "com.acme.kanban",
            version,
            audience: json!({ "kind": "workspace" }),
            capabilities: json!([
                { "cap": "canvas", "why": "Draws the board", "optional": false },
                { "cap": "nodes.read", "why": "Lists cards", "optional": false },
                { "cap": "storage.user", "why": "Remembers widths", "optional": true }
            ]),
        }
    }
}

/// The manifest's bytes for `spec`, published by `key`, naming `wasm`.
pub(crate) fn manifest(spec: &Spec, key: &AppSigningKey, wasm: &[u8]) -> Vec<u8> {
    let mut icon = b"\x89PNG\r\n\x1a\n".to_vec();
    icon.resize(64, 0);
    let value = json!({
        "format": 1,
        "id": spec.id,
        "version": spec.version,
        "sdk": { "abi": "citadel-app-abi-1", "min": "1.0.0", "max": "1.x" },
        "publisher": { "name": "Acme", "mldsa65_public_key": key.public_key_hex(), "contact": "https://acme.example/apps" },
        "name": "Kanban",
        "summary": "Cards in columns",
        "description": "Cards.",
        "icon": { "png_base64": base64::engine::general_purpose::STANDARD.encode(icon), "max_bytes": 65536 },
        "categories": ["planning"],
        "audience": spec.audience,
        "surfaces": ["canvas_pane"],
        "scopes": ["workspace", "node", "node_tree", "users", "self"],
        "capabilities": spec.capabilities,
        "limits": { "memory_pages": 16, "max_call_rate_per_s": 20, "frame_budget_ms": 16, "storage_user_bytes": 1024, "storage_scope_bytes": 1024 },
        "artifact": {
            "sha256": hex::encode(sha256(wasm)),
            "bytes": wasm.len(),
            "locations": [{ "kind": "https", "url": ARTIFACT_URL }]
        }
    });
    serde_json::to_vec(&value).expect("json")
}

/// `spec` published by `key` over `wasm`, as a signed listing.
pub(crate) fn signed(spec: &Spec, key: &AppSigningKey, wasm: &[u8]) -> ListingOffer {
    let manifest_bytes = manifest(spec, key, wasm);
    let digests = ArtifactDigests::of(&manifest_bytes, wasm);
    let signature = key.sign(spec.id, spec.version, &digests).expect("sign");
    ListingOffer::Signed {
        manifest_bytes,
        signature,
    }
}

/// Upload `wasm` as `user`, chunk by chunk.
pub(crate) async fn upload(kernel: &Kernel, user: &str, wasm: &[u8]) -> AppsResponse {
    let sha256 = hex::encode(sha256(wasm));
    let parts: Vec<&[u8]> = wasm.chunks(ARTIFACT_CHUNK_BYTES as usize).collect();
    let mut last = None;
    for (index, bytes) in parts.iter().enumerate() {
        let request = AppsRequest::UploadArtifactChunk {
            sha256: sha256.clone(),
            index: index as u32,
            total_chunks: parts.len() as u32,
            bytes: bytes.to_vec(),
        };
        last = Some(ask(kernel, user, request).await);
    }
    last.expect("a chunk")
}

/// The host's network, for the tests that need an artifact fetched by URL: it answers each URL
/// with the bytes it was given, and fails for any other. A stand-in because the real fetchers'
/// I/O (a Durable Object's `fetch`, an HTTPS client) cannot run in a unit test; the kernel's
/// own checks of what comes back are the code under test.
pub(crate) struct ServedBytes(pub HashMap<String, Vec<u8>>);

#[async_trait::async_trait]
impl super::fetcher::ArtifactFetcher for ServedBytes {
    async fn fetch(
        &self,
        url: &str,
        max_bytes: u32,
    ) -> Result<Vec<u8>, super::fetcher::FetchRefusal> {
        match self.0.get(url) {
            Some(bytes) if bytes.len() <= max_bytes as usize => Ok(bytes.clone()),
            Some(_) => Err(super::fetcher::FetchRefusal::TooLarge),
            None => Err(super::fetcher::FetchRefusal::Failed(
                "not served".to_string(),
            )),
        }
    }
}

/// Where `manifest` says every test artifact is.
pub(crate) const ARTIFACT_URL: &str = "https://apps.acme.example/kanban.wasm";

/// `workspace()` whose host serves `bytes` at `ARTIFACT_URL`.
pub(crate) async fn workspace_serving(bytes: Vec<u8>) -> Kernel {
    let mut kernel = workspace().await;
    let served = ServedBytes([(ARTIFACT_URL.to_string(), bytes)].into());
    kernel.set_artifact_fetcher(Some(std::sync::Arc::new(served)));
    kernel
}

/// An install request for `listing` at `scope`, granting `granted`, by `key`'s holder's trust.
pub(crate) fn install_request(
    spec: &Spec,
    key: &AppSigningKey,
    listing: ListingOffer,
    scope: citadel_workspace_types::apps::InstallScope,
    granted: &[citadel_workspace_types::apps::Capability],
    inject_requirement: bool,
) -> AppsRequest {
    AppsRequest::Install {
        app_id: spec.id.to_string(),
        version: spec.version.to_string(),
        listing,
        scope,
        granted: granted.to_vec(),
        pinned_publisher_key: key.public_key_hex(),
        inject_requirement,
    }
}

/// The refusal in `response`, if it is one.
pub(crate) fn refused(response: &AppsResponse) -> Option<&AppsRefusal> {
    match response {
        AppsResponse::Refused(refusal) => Some(refusal),
        _ => None,
    }
}

/// An install that came back active.
pub(crate) fn installed(response: &AppsResponse) -> bool {
    matches!(response, AppsResponse::Installed { install } if install.state == InstallState::Active)
}
