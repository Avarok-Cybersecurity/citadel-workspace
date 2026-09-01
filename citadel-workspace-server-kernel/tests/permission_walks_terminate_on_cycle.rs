//! # Ancestor walks must terminate on a cyclic tree
//!
//! `check_entity_permission` walks the `parent_id` chain with a while-loop and
//! `is_member_of_domain` walked it by recursion — neither had a cycle guard.
//! `is_ancestor_of` in tree_validator grew exactly that guard, with a comment
//! recording why it matters: a pre-existing cycle (corruption, a manual
//! backend edit, an older binary's bug) does not fail one request, it wedges
//! every operation that checks a permission — i.e. every request — forever.
//!
//! These tests plant a parent-chain ring and bound both walks with a generous
//! timeout: unguarded, the loop spins across awaits and the recursion grows
//! without bound, and the timeout fires.

use citadel_workspace_server_kernel::handlers::domain::async_ops::AsyncPermissionOperations;
use citadel_workspace_types::structs::{
    DomainNode, DomainPermissions, NodeEntityType, Permission, User, UserRole,
};
use common::workspace_test_utils::create_test_kernel;
use std::collections::HashMap;
use std::time::Duration;

fn node(id: &str, parent: &str) -> DomainNode {
    DomainNode {
        id: id.to_string(),
        parent_id: Some(parent.to_string()),
        entity_type: NodeEntityType::Child("Office".to_string()),
        depth: 1,
        name: format!("node-{id}"),
        description: String::new(),
        owner_id: "nobody".to_string(),
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

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn permission_walks_terminate_on_a_cyclic_tree() {
    let kernel = create_test_kernel().await;
    let backend = &kernel.domain_operations.backend_tx_manager;

    // A 3-ring in parent_id: A -> C -> B -> A. No member, no grant anywhere,
    // so both walks must run the ring to their (guarded) end.
    let mut nodes = HashMap::new();
    nodes.insert("A".to_string(), node("A", "C"));
    nodes.insert("B".to_string(), node("B", "A"));
    nodes.insert("C".to_string(), node("C", "B"));
    backend.save_nodes(&nodes).await.expect("seed cycle");

    // The walker only runs for an EXISTING non-admin user with no matching
    // direct grant — a missing user short-circuits to false before the walk.
    backend
        .insert_user(
            "victim".to_string(),
            User {
                id: "victim".to_string(),
                name: "Victim".to_string(),
                role: UserRole::Member,
                permissions: HashMap::new(),
                metadata: HashMap::new(),
            },
        )
        .await
        .expect("seed user");

    let ops = &kernel.domain_operations;

    let granted = tokio::time::timeout(
        Duration::from_secs(10),
        ops.check_entity_permission("victim", "A", Permission::EditContent),
    )
    .await
    .expect(
        "check_entity_permission must terminate on a cyclic tree — \
         unguarded, its ancestor loop walks the ring forever",
    )
    .expect("no backend error");
    assert!(!granted, "nothing grants EditContent on the ring");

    let member = tokio::time::timeout(
        Duration::from_secs(10),
        ops.is_member_of_domain("victim", "A"),
    )
    .await
    .expect(
        "is_member_of_domain must terminate on a cyclic tree — \
         unguarded, its recursion re-enters the ring without bound",
    )
    .expect("no backend error");
    assert!(!member, "the victim is a member of nothing on the ring");
}
