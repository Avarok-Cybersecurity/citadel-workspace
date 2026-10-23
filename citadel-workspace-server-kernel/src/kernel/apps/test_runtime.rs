//! What the app-runtime tests share: an app asking for every server-backed capability, an
//! install of it with a chosen grant, and a way to make host calls and relay frames as a member
//! on a session.

use super::test_manifests::*;
use super::test_support::Kernel;
use crate::kernel::command_processor::async_process_command::process_command_with_user_and_cid;
use citadel_app_sdk_types::{decode, encode, HostCall, HostReply};
use citadel_workspace_types::apps::{Capability, InstallScope};
use citadel_workspace_types::apps_protocol::AppsRequest;
use citadel_workspace_types::apps_responses::AppsResponse;
use citadel_workspace_types::{WorkspaceProtocolRequest, WorkspaceProtocolResponse};
use serde::de::DeserializeOwned;
use serde_json::json;

pub(crate) const APP_ID: &str = "com.acme.kanban";
pub(crate) const API_HOST: &str = "api.acme.example";

/// Every capability the server serves, all optional, so each test grants what it needs.
pub(crate) fn runtime_spec() -> Spec {
    let optional = |cap: &str| json!({ "cap": cap, "why": "Needed", "optional": true });
    Spec {
        capabilities: json!([
            { "cap": "canvas", "why": "Draws", "optional": false },
            optional("storage.user"),
            optional("storage.scope"),
            optional("storage.node"),
            optional("storage.blob"),
            optional("storage.local"),
            { "cap": "net.server", "why": "Syncs", "optional": true, "hosts": [API_HOST] },
            { "cap": "ihttp.serve", "why": "Serves", "optional": true, "routes": ["GET /cards"] },
            { "cap": "ihttp.call", "why": "Calls", "optional": true, "targets": [] },
        ]),
        ..Spec::new("1.0.0")
    }
}

/// Install the runtime app as `installer` at `scope`, granting `granted` (canvas is added).
/// Answers the install id.
pub(crate) async fn install(
    kernel: &Kernel,
    installer: &str,
    scope: InstallScope,
    granted: &[Capability],
) -> String {
    let (key, bytes, spec) = (publisher(1), wasm(1, 4096), runtime_spec());
    let mut caps = vec![Capability::Canvas];
    caps.extend_from_slice(granted);
    let listing = signed(&spec, &key, &bytes);
    let request = install_request(&spec, &key, listing, scope, &caps, false);
    match ask_on(kernel, installer, None, request).await {
        AppsResponse::Installed { install } => install.id,
        other => panic!("not installed: {other:?}"),
    }
}

/// `request` as `user` on the session `cid`.
pub(crate) async fn ask_on(
    kernel: &Kernel,
    user: &str,
    cid: Option<u64>,
    request: AppsRequest,
) -> AppsResponse {
    let request = WorkspaceProtocolRequest::Apps(request);
    match process_command_with_user_and_cid(kernel, &request, user, cid).await {
        Ok(WorkspaceProtocolResponse::Apps(response)) => response,
        other => panic!("{other:?}"),
    }
}

/// The raw answer to `call` made by `user` through `install_id`.
pub(crate) async fn call_raw(
    kernel: &Kernel,
    user: &str,
    install_id: &str,
    call: &HostCall,
) -> AppsResponse {
    let request = AppsRequest::Call {
        install_id: install_id.to_string(),
        call: encode(call),
    };
    ask_on(kernel, user, None, request).await
}

/// The reply to `call`, read as the op's reply type `T`.
pub(crate) async fn call<T: DeserializeOwned>(
    kernel: &Kernel,
    user: &str,
    install_id: &str,
    call: &HostCall,
) -> HostReply<T> {
    match call_raw(kernel, user, install_id, call).await {
        AppsResponse::CallReply { reply } => decode(&reply).expect("a HostReply"),
        other => panic!("not a reply: {other:?}"),
    }
}
