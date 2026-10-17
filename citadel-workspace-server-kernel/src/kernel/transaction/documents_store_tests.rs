//! What a compaction and a node delete leave in storage.
//!
//! The protocol cannot see an orphaned key: a compaction that kept the updates it folded in
//! answers every pull exactly as one that dropped them, because the head no longer names them.
//! So these read the test store's keys directly, which only an in-crate test can.

use crate::handlers::domain::node_ops::AsyncNodeOperations;
use crate::kernel::async_kernel::AsyncWorkspaceServerKernel;
use crate::kernel::command_processor::async_process_command::process_command_with_user_and_cid;
use crate::kernel::documents::{DocumentsConfig, DocumentsRelay};
use citadel_sdk::prelude::StackedRatchet;
use citadel_workspace_types::documents::{DocumentsRequest, DocumentsResponse};
use citadel_workspace_types::structs::{
    DomainNode, DomainPermissions, NodeEntityType, User, UserRole, Workspace,
};
use citadel_workspace_types::{WorkspaceProtocolRequest, WorkspaceProtocolResponse};
use std::collections::HashMap;

type Kernel = AsyncWorkspaceServerKernel<StackedRatchet>;
const NODE: &str = "doc-node";

fn node() -> DomainNode {
    DomainNode {
        id: NODE.to_string(),
        parent_id: Some(crate::WORKSPACE_ROOT_ID.to_string()),
        entity_type: NodeEntityType::Child("Office".to_string()),
        depth: 1,
        name: "Doc".to_string(),
        description: String::new(),
        owner_id: "admin".to_string(),
        members: vec![],
        children: vec![],
        mdx_content: String::new(),
        mdx_content_hash: None,
        rules: None,
        chat_enabled: false,
        chat_channel_id: None,
        default_permissions: DomainPermissions::default(),
        metadata: vec![],
        allowed_child_types: None,
        is_default: false,
        created_at: 0,
        updated_at: 0,
    }
}

async fn kernel() -> Kernel {
    let mut kernel = Kernel::new(None);
    // Large enough that no bound is reached here; the bounds have their own tests.
    let limits = DocumentsConfig {
        max_updates_per_pull: 100,
        snapshot_min_updates: 100,
        max_update_bytes: 1024,
        max_snapshot_bytes: 1024,
        max_awareness_bytes: 1024,
        awareness_per_second: 100,
    };
    kernel.set_documents_relay(DocumentsRelay::new(limits).expect("limits"));
    let backend = &kernel.domain_operations.backend_tx_manager;
    let admin = User::new("admin".to_string(), "Admin".to_string(), UserRole::Admin);
    backend
        .insert_user("admin".to_string(), admin)
        .await
        .expect("admin");
    // A role confers its permissions within its own workspace, and nowhere without one.
    let workspace = Workspace {
        id: crate::WORKSPACE_ROOT_ID.to_string(),
        name: "Root".to_string(),
        description: String::new(),
        owner_id: "admin".to_string(),
        members: vec!["admin".to_string()],
        offices: vec![],
        metadata: vec![],
    };
    backend
        .insert_workspace(crate::WORKSPACE_ROOT_ID.to_string(), workspace)
        .await
        .expect("workspace");
    backend
        .save_nodes(&HashMap::from([(NODE.to_string(), node())]))
        .await
        .expect("node");
    kernel
}

async fn ask(kernel: &Kernel, request: DocumentsRequest) -> DocumentsResponse {
    let request = WorkspaceProtocolRequest::Documents(request);
    match process_command_with_user_and_cid(kernel, &request, "admin", Some(1)).await {
        Ok(WorkspaceProtocolResponse::Documents(answer)) => answer,
        other => panic!("expected a documents answer, got {other:?}"),
    }
}

async fn write(kernel: &Kernel, updates: u8, snapshot_upto: u64) {
    for i in 0..updates {
        let append = DocumentsRequest::Append {
            node_id: NODE.to_string(),
            doc_version: 1,
            update: vec![i],
            client_seq: u64::from(i),
        };
        assert!(matches!(
            ask(kernel, append).await,
            DocumentsResponse::Appended { .. }
        ));
    }
    let snapshot = DocumentsRequest::StoreSnapshot {
        node_id: NODE.to_string(),
        doc_version: 1,
        snapshot: vec![9],
        upto_seq: snapshot_upto,
    };
    assert!(matches!(
        ask(kernel, snapshot).await,
        DocumentsResponse::SnapshotStored { .. }
    ));
}

fn document_keys(kernel: &Kernel) -> Vec<String> {
    let mut keys: Vec<String> = kernel
        .domain_operations
        .backend_tx_manager
        .stored_keys()
        .into_iter()
        .filter(|k| k.starts_with(&format!("citadel_workspace.documents.{NODE}.")))
        .collect();
    keys.sort();
    keys
}

#[tokio::test]
async fn a_snapshot_deletes_exactly_the_updates_it_covers() {
    let kernel = kernel().await;
    write(&kernel, 5, 3).await;
    let prefix = format!("citadel_workspace.documents.{NODE}");
    assert_eq!(
        document_keys(&kernel),
        vec![
            format!("{prefix}.head"),
            format!("{prefix}.snapshot"),
            format!("{prefix}.update.4"),
            format!("{prefix}.update.5"),
        ]
    );
}

#[tokio::test]
async fn deleting_the_node_leaves_no_key_of_its_document() {
    let kernel = kernel().await;
    write(&kernel, 4, 2).await;
    assert!(
        !document_keys(&kernel).is_empty(),
        "nothing was written to delete"
    );

    kernel
        .domain_operations
        .delete_node("admin", NODE, false)
        .await
        .expect("delete");
    assert_eq!(document_keys(&kernel), Vec::<String>::new());
}
