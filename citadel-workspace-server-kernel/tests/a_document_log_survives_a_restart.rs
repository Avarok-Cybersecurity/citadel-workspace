//! A document's log is in the backend, not the process: it is all there after a restart, and
//! numbering carries on where it stopped.
//!
//! Every other kernel test runs on the in-memory test store, which a second kernel cannot see,
//! so none of them could tell a log kept in the backend from one kept in a field. This one runs
//! the kernel on a real node over the SQLite backend production uses
//! (`docker-compose.production.yml`), stops it, and starts a second kernel on the same file.

use citadel_sdk::prelude::*;
use citadel_workspace_server_kernel::handlers::domain::node_ops::AsyncNodeOperations;
use citadel_workspace_server_kernel::kernel::async_kernel::AsyncWorkspaceServerKernel;
use citadel_workspace_server_kernel::kernel::command_processor::async_process_command::process_command_with_user_and_cid;
use citadel_workspace_server_kernel::kernel::documents::DocumentsRelay;
use citadel_workspace_server_kernel::WORKSPACE_ROOT_ID;
use citadel_workspace_types::documents::{DocumentsRequest, DocumentsResponse};
use citadel_workspace_types::structs::{NodeEntityType, User, UserRole};
use citadel_workspace_types::WorkspaceProtocolRequest;
use common::documents_test_utils::{documents, pulled, shipped_documents_config};
use std::time::Duration;

type Kernel = AsyncWorkspaceServerKernel<StackedRatchet>;
const AUTHOR: &str = "author";

/// A kernel serving on a fresh port over the SQLite file at `db`, once it has initialised.
async fn boot(db: &std::path::Path) -> (Kernel, tokio::task::JoinHandle<()>) {
    let mut kernel = Kernel::with_workspace_master_password("restart-test-password")
        .await
        .expect("kernel");
    kernel.set_documents_relay(DocumentsRelay::new(shipped_documents_config()).expect("limits"));
    let handle = kernel.clone();

    let addr = std::net::TcpListener::bind("127.0.0.1:0")
        .and_then(|l| l.local_addr())
        .expect("free port");
    let mut builder = DefaultNodeBuilder::default();
    builder
        .with_node_type(NodeType::server(addr).expect("server node type"))
        .with_backend(BackendType::sql(format!(
            "sqlite://{}?mode=rwc",
            db.display()
        )));
    let node = builder.build(kernel).expect("server node");
    let task = tokio::spawn(async move {
        let _ = node.await;
    });

    for _ in 0..200 {
        let backend = &handle.domain_operations.backend_tx_manager;
        if !backend.is_test_mode()
            && matches!(backend.get_workspace(WORKSPACE_ROOT_ID).await, Ok(Some(_)))
        {
            return (handle, task);
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    panic!("the kernel never initialised its backend");
}

async fn stop(kernel: Kernel, task: tokio::task::JoinHandle<()>) {
    let remote = kernel.node_remote.read().clone().expect("a running node");
    remote.shutdown().await.expect("shutdown");
    tokio::time::timeout(Duration::from_secs(30), task)
        .await
        .expect("the node did not stop")
        .expect("node task");
}

async fn ask(kernel: &Kernel, request: DocumentsRequest) -> DocumentsResponse {
    documents(
        process_command_with_user_and_cid(
            kernel,
            &WorkspaceProtocolRequest::Documents(request),
            AUTHOR,
            Some(3),
        )
        .await
        .expect("dispatch"),
    )
}

async fn append(kernel: &Kernel, node: &str, body: &[u8]) -> u64 {
    let request = DocumentsRequest::Append {
        node_id: node.to_string(),
        doc_version: 1,
        update: body.to_vec(),
        client_seq: 0,
    };
    match ask(kernel, request).await {
        DocumentsResponse::Appended { seq, .. } => seq,
        other => panic!("append refused: {other:?}"),
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn the_log_and_its_snapshot_survive_a_restart() {
    let dir = std::env::temp_dir().join(format!("citadel-docs-restart-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).expect("temp dir");
    let db = dir.join("kernel.db");

    let (kernel, task) = boot(&db).await;
    let backend = &kernel.domain_operations.backend_tx_manager;
    let author = User::new(AUTHOR.to_string(), "Author".to_string(), UserRole::Admin);
    backend
        .insert_user(AUTHOR.to_string(), author)
        .await
        .expect("insert author");
    let mut workspace = backend
        .get_workspace(WORKSPACE_ROOT_ID)
        .await
        .expect("read")
        .expect("root");
    workspace.members.push(AUTHOR.to_string());
    backend
        .insert_workspace(WORKSPACE_ROOT_ID.to_string(), workspace)
        .await
        .expect("join");
    let node = kernel
        .domain_operations
        .create_node(
            AUTHOR,
            Some(WORKSPACE_ROOT_ID),
            &NodeEntityType::Child("Office".to_string()),
            "Doc",
            "",
        )
        .await
        .expect("create node")
        .id;
    for body in [b"u1".as_slice(), b"u2", b"u3"] {
        append(&kernel, &node, body).await;
    }
    let stored = ask(
        &kernel,
        DocumentsRequest::StoreSnapshot {
            node_id: node.clone(),
            doc_version: 1,
            snapshot: b"S2".to_vec(),
            upto_seq: 2,
        },
    )
    .await;
    assert!(
        matches!(
            stored,
            DocumentsResponse::SnapshotStored { upto_seq: 2, .. }
        ),
        "{stored:?}"
    );
    stop(kernel, task).await;

    let (kernel, task) = boot(&db).await;
    let after = ask(
        &kernel,
        DocumentsRequest::Pull {
            node_id: node.clone(),
            since_seq: 0,
        },
    )
    .await;
    let DocumentsResponse::Updates {
        snapshot,
        latest_seq,
        ..
    } = &after
    else {
        panic!("expected Updates, got {after:?}");
    };
    assert_eq!(
        snapshot.as_ref().map(|s| (s.bytes.clone(), s.upto_seq)),
        Some((b"S2".to_vec(), 2))
    );
    assert_eq!(pulled(&after), vec![b"u3".to_vec()]);
    assert_eq!(*latest_seq, 3);
    assert_eq!(
        append(&kernel, &node, b"u4").await,
        4,
        "numbering restarted after a restart"
    );
    stop(kernel, task).await;
    let _ = std::fs::remove_dir_all(&dir);
}
