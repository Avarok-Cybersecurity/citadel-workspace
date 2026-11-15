//! A manifest's `limits.storage_node_authored_bytes` through the kernel: what an app declared for
//! `storage.node.authored` is the cap each author's namespace is held to, below the platform's.

use super::kernel_call_tests::{get, set, value};
use super::test_manifests::*;
use super::test_runtime::*;
use citadel_app_sdk_types::calls::KvBackend;
use citadel_app_sdk_types::{HostReply, Refused};
use citadel_workspace_types::apps::{Capability, InstallScope};
use serde_json::json;

fn mine(node: &str) -> KvBackend {
    KvBackend::NodeAuthored {
        node_id: node.into(),
        author: None,
    }
}

/// The runtime app, declaring 1024 bytes per author per node.
fn declaring_a_kib() -> Spec {
    let mut spec = runtime_spec();
    spec.limits["storage_node_authored_bytes"] = json!(1024);
    spec
}

#[tokio::test]
async fn a_post_over_the_declared_authored_limit_is_refused_though_the_platform_s_would_take_it() {
    let kernel = workspace_serving(wasm(1, 4096)).await;
    let caps = &[Capability::StorageNodeAuthored];
    let id = install_spec(
        &kernel,
        "boss",
        InstallScope::Workspace,
        caps,
        &declaring_a_kib(),
    )
    .await;
    let fits: HostReply<()> =
        call(&kernel, "alice", &id, &set(mine("room"), "a", &[0; 1000])).await;
    assert_eq!(fits, HostReply::Ok(()));
    // 1100 bytes is far below the platform's 256 KiB, and over the 1024 the manifest declared.
    let over: HostReply<()> = call(&kernel, "alice", &id, &set(mine("room"), "b", &[0; 100])).await;
    assert_eq!(over, HostReply::Refused(Refused::Limit("quota".into())));
    let unchanged = call(&kernel, "alice", &id, &get(mine("room"), "b")).await;
    assert_eq!(value(unchanged), None);
    // Each author is held to the declared limit separately.
    let bob: HostReply<()> = call(&kernel, "bob", &id, &set(mine("room"), "a", &[0; 1000])).await;
    assert_eq!(bob, HostReply::Ok(()));
}
