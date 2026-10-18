//! Driving the Documents relay through the real command processor.
//!
//! The limits are the shipped ones, read from `docker/workspace-server/kernel.toml`, so a test
//! cannot pass under bounds no server runs with. A test that needs a bound small enough to
//! reach says so with `with_limits`.

pub use crate::crdt_test_utils::*;
use crate::member_test_utils::{create_test_user, insert_user_with_role, join_root, GateKernel};
use crate::workspace_test_utils::{create_configured_test_kernel, TEST_ADMIN_USER_ID};
use citadel_workspace_server_kernel::handlers::domain::node_ops::AsyncNodeOperations;
use citadel_workspace_server_kernel::kernel::async_kernel::BroadcastMessage;
use citadel_workspace_server_kernel::kernel::command_processor::async_process_command::process_command_with_user_and_cid;
use citadel_workspace_server_kernel::kernel::documents::{DocumentsConfig, DocumentsRelay};
use citadel_workspace_types::documents::{DocumentsRequest, DocumentsResponse};
use citadel_workspace_types::structs::{NodeEntityType, Permission, UserRole};
use citadel_workspace_types::{WorkspaceProtocolRequest, WorkspaceProtocolResponse};
use std::sync::Arc;
use std::time::Duration;

/// The `[documents]` table of the shipped kernel.toml, to the end of the file.
pub fn shipped_documents_section() -> String {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../../docker/workspace-server/kernel.toml");
    let raw = std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("cannot read {}: {e}", path.display()));
    let start = raw
        .find("[documents]")
        .expect("the shipped kernel.toml has no [documents] table");
    raw[start..].to_string()
}

pub fn shipped_documents_config() -> DocumentsConfig {
    let table: toml::Value =
        toml::from_str(&shipped_documents_section()).expect("the shipped [documents] parses");
    table
        .get("documents")
        .cloned()
        .expect("a [documents] table")
        .try_into()
        .expect("the shipped [documents] holds every limit")
}

pub async fn documents_kernel() -> Arc<GateKernel> {
    with_limits(shipped_documents_config()).await
}

pub async fn with_limits(config: DocumentsConfig) -> Arc<GateKernel> {
    let relay = DocumentsRelay::new(config).expect("valid limits");
    create_configured_test_kernel(|kernel| kernel.set_documents_relay(relay)).await
}

/// A node made by the admin, as documents are.
pub async fn document_node(kernel: &GateKernel) -> String {
    kernel
        .domain_operations
        .create_node(
            TEST_ADMIN_USER_ID,
            Some(citadel_workspace_server_kernel::WORKSPACE_ROOT_ID),
            &NodeEntityType::Child("Office".to_string()),
            "Spec",
            "",
            None,
        )
        .await
        .expect("the admin may create a node")
        .id
}

/// A workspace member: the Member role reads every node and edits none.
pub async fn reader(kernel: &GateKernel, id: &str) {
    insert_user_with_role(kernel, id, UserRole::Member).await;
    join_root(kernel, id).await;
}

/// A member granted `EditMdx` on `node`, as an admin grants document editing.
pub async fn writer(kernel: &GateKernel, id: &str, node: &str) {
    let mut user = create_test_user(id, UserRole::Member);
    user.permissions.insert(
        node.to_string(),
        [Permission::EditMdx].into_iter().collect(),
    );
    kernel
        .domain_operations
        .backend_tx_manager
        .insert_user(id.to_string(), user)
        .await
        .expect("insert user");
    join_root(kernel, id).await;
}

pub async fn send(
    kernel: &GateKernel,
    user: &str,
    cid: u64,
    request: DocumentsRequest,
) -> WorkspaceProtocolResponse {
    process_command_with_user_and_cid(
        kernel,
        &WorkspaceProtocolRequest::Documents(request),
        user,
        Some(cid),
    )
    .await
    .expect("dispatch")
}

/// The documents answer, or a panic naming what came instead.
pub fn documents(response: WorkspaceProtocolResponse) -> DocumentsResponse {
    match response {
        WorkspaceProtocolResponse::Documents(answer) => answer,
        other => panic!("expected a documents answer, got {other:?}"),
    }
}

pub async fn append(kernel: &GateKernel, user: &str, cid: u64, node: &str, update: &[u8]) -> u64 {
    let request = DocumentsRequest::Append {
        node_id: node.to_string(),
        doc_version: 1,
        update: update.to_vec(),
        client_seq: 0,
    };
    match documents(send(kernel, user, cid, request).await) {
        DocumentsResponse::Appended { seq, .. } => seq,
        other => panic!("append was not stored: {other:?}"),
    }
}

pub async fn pull(
    kernel: &GateKernel,
    user: &str,
    node: &str,
    since_seq: u64,
) -> DocumentsResponse {
    let request = DocumentsRequest::Pull {
        node_id: node.to_string(),
        since_seq,
    };
    documents(send(kernel, user, 1, request).await)
}

/// The update bytes a pull returned, in order.
pub fn pulled(response: &DocumentsResponse) -> Vec<Vec<u8>> {
    match response {
        DocumentsResponse::Updates { updates, .. } => {
            updates.iter().map(|u| u.update.clone()).collect()
        }
        other => panic!("expected Updates, got {other:?}"),
    }
}

/// Every broadcast that arrives within a short window.
pub async fn drain(
    rx: &mut tokio::sync::broadcast::Receiver<BroadcastMessage>,
) -> Vec<BroadcastMessage> {
    let mut seen = Vec::new();
    while let Ok(Ok(msg)) = tokio::time::timeout(Duration::from_millis(200), rx.recv()).await {
        seen.push(msg);
    }
    seen
}
