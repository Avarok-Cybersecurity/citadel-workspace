//! A valid manifest, as JSON a test changes one field of.

#![allow(dead_code)]

pub mod md;

use base64::Engine;
use citadel_workspace_types::apps_manifest::{AppManifest, ManifestRefusal};
use serde_json::{json, Value};

pub fn png(len: usize) -> String {
    let mut bytes = b"\x89PNG\r\n\x1a\n".to_vec();
    bytes.resize(len.max(8), 0);
    base64::engine::general_purpose::STANDARD.encode(bytes)
}

pub fn valid() -> Value {
    json!({
        "format": 1,
        "id": "com.acme.kanban",
        "version": "1.4.0",
        "sdk": { "abi": "citadel-app-abi-1", "min": "1.0.0", "max": "1.x" },
        "publisher": { "name": "Acme", "mldsa65_public_key": "ab".repeat(1952), "contact": "https://acme.example/apps" },
        "name": "Kanban",
        "summary": "Cards in columns",
        "description": "Lists cards from child nodes.\nDrag them between columns.",
        "icon": { "png_base64": png(64), "max_bytes": 65536 },
        "categories": ["planning"],
        "audience": { "kind": "global" },
        "surfaces": ["canvas_pane", "md_zone"],
        "scopes": ["workspace", "node", "node_tree", "users", "self"],
        "capabilities": [
            { "cap": "canvas", "why": "Draws the board", "optional": false },
            { "cap": "nodes.read", "why": "Lists cards from child nodes", "optional": false },
            { "cap": "storage.user", "why": "Remembers your column widths", "optional": true },
            { "cap": "net.server", "hosts": ["api.acme.com", "sync.acme.com:8443"], "why": "Syncs with Acme", "optional": true },
            { "cap": "ihttp.serve", "routes": ["GET /cards/:id", "POST /cards", "GET /static/*"], "why": "Shares your board", "optional": true },
            { "cap": "ihttp.call", "targets": ["com.acme.lint"], "why": "Asks the linter", "optional": true }
        ],
        "limits": { "memory_pages": 1024, "max_call_rate_per_s": 200, "frame_budget_ms": 16, "storage_user_bytes": 1048576, "storage_scope_bytes": 8388608, "close_grace_ms": 500 },
        "artifact": {
            "sha256": "0".repeat(64),
            "bytes": 1234567,
            "locations": [
                { "kind": "https", "url": "https://github.com/acme/kanban/releases/download/v1.4.0/app.wasm" },
                { "kind": "github_pinned", "repo": "acme/kanban", "commit": "a".repeat(40), "path": "dist/app.wasm" }
            ]
        },
        "previous_versions": ["1.3.2"]
    })
}

pub fn read(value: &Value) -> Result<AppManifest, ManifestRefusal> {
    AppManifest::from_bytes(&serde_json::to_vec(value).unwrap())
}

/// The valid manifest with `change` applied: what reading it answers.
pub fn with(change: impl FnOnce(&mut Value)) -> Result<AppManifest, ManifestRefusal> {
    let mut value = valid();
    change(&mut value);
    read(&value)
}

/// A capability entry at `index` of the valid manifest, replaced by `entry`.
pub fn with_cap(index: usize, entry: Value) -> Result<AppManifest, ManifestRefusal> {
    with(|m| m["capabilities"][index] = entry)
}
