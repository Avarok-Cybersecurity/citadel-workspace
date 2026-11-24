//! Signing the committed first-party apps with a throwaway seed for the kernel tests, exactly as
//! the signer would (apps/first-party/signer: the signer's key written into the manifest,
//! pretty-printed with a final newline, the signature over its digest and the module's). The
//! deploy's key cannot sign here, so these releases are trusted only by the calls that name
//! `Signed::key`.
#![allow(dead_code)]

use citadel_app_signature::{AppSigningKey, ArtifactDigests};
use citadel_workspace_server_kernel::kernel::apps::first_party::SignedBundle;
use citadel_workspace_server_kernel::kernel::command_processor::async_process_command::process_command_with_user;
use citadel_workspace_types::apps::InstallScope;
use citadel_workspace_types::apps_install::AppInstall;
use citadel_workspace_types::apps_protocol::AppsRequest;
use citadel_workspace_types::apps_responses::AppsResponse;
use citadel_workspace_types::{WorkspaceProtocolRequest, WorkspaceProtocolResponse};
use common::member_test_utils::GateKernel as Kernel;
use common::workspace_test_utils::TEST_ADMIN_USER_ID;
use std::path::Path;

pub const CALENDAR: &str = "net.avarok.calendar";

pub struct Signed {
    pub manifest: Vec<u8>,
    pub signature: String,
    pub key: String,
    /// The module the bundle carries: what the signer writes beside a release whose module the
    /// server stores. None unless `signed_with_module` made it.
    pub module: Option<Vec<u8>>,
}

impl Signed {
    pub fn bundle(&self) -> SignedBundle<'_> {
        SignedBundle {
            manifest: &self.manifest,
            signature: &self.signature,
            module: self.module.as_deref(),
        }
    }
}

/// The committed Calendar, signed with `seed_byte` repeated: a seed for these tests only.
pub fn signed_calendar(seed_byte: &str) -> Signed {
    signed(
        "apps/first-party/calendar/manifest.json",
        "citadel-workspaces/public/calendar/calendar_glue_bg.wasm",
        seed_byte,
    )
}

/// The committed app whose manifest and module these are, signed with `seed_byte` repeated.
pub fn signed(manifest: &str, module: &str, seed_byte: &str) -> Signed {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("..");
    let read = |p: &str| std::fs::read(root.join(p)).unwrap_or_else(|e| panic!("{p}: {e}"));
    let key = AppSigningKey::from_seed_hex(&seed_byte.repeat(32)).expect("seed");
    let mut manifest: serde_json::Value = serde_json::from_slice(&read(manifest)).expect("json");
    manifest["publisher"]["mldsa65_public_key"] = key.public_key_hex().into();
    let mut bytes = serde_json::to_vec_pretty(&manifest).expect("json");
    bytes.push(b'\n');
    let wasm = read(module);
    let (id, version) = (manifest["id"].as_str(), manifest["version"].as_str());
    let signature = key
        .sign(
            id.expect("id"),
            version.expect("version"),
            &ArtifactDigests::of(&bytes, &wasm),
        )
        .expect("sign");
    Signed {
        manifest: bytes,
        signature,
        key: key.public_key_hex(),
        module: None,
    }
}

/// `signed`, the bundle carrying the module as the signer's output does for an app-ABI app.
pub fn signed_with_module(manifest: &str, module: &str, seed_byte: &str) -> Signed {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("..");
    let wasm = std::fs::read(root.join(module)).unwrap_or_else(|e| panic!("{module}: {e}"));
    Signed {
        module: Some(wasm),
        ..signed(manifest, module, seed_byte)
    }
}

pub async fn workspace_installs(kernel: &Kernel) -> Vec<AppInstall> {
    let request = WorkspaceProtocolRequest::Apps(AppsRequest::ListInstalls);
    match process_command_with_user(kernel, &request, TEST_ADMIN_USER_ID)
        .await
        .expect("dispatched")
    {
        WorkspaceProtocolResponse::Apps(AppsResponse::Installs { installs, .. }) => installs
            .into_iter()
            .filter(|i| i.scope == InstallScope::Workspace)
            .collect(),
        other => panic!("no installs: {other:?}"),
    }
}
