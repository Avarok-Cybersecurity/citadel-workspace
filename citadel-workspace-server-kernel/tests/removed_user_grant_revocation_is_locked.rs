//! # Removing a user's grant must hold the user-record lock
//!
//! The tail of `remove_user_from_domain` revokes the removed user's own
//! `permissions[domain_id]` entry with a get_user → modify → insert_user
//! cycle. Both branch guards are scoped to their branches and have dropped by
//! then, so this read-modify-write used to run with NO lock — the third site
//! of the lost-update race that `write_user_role` and `delete_workspace`'s
//! cleanup both document. A concurrent user write landing inside the window
//! silently loses one side: a role change is reverted, or the revocation is —
//! and `check_entity_permission` honours `user.permissions[domain_id]` BEFORE
//! membership, so a surviving grant keeps the removed user's access.
//!
//! A true interleaving cannot be staged deterministically here, so this test
//! covers the LOCK ACQUISITION, not the race itself: it holds
//! `lock_workspaces` and asserts the revocation cannot complete until the
//! lock is released. Without the fix, the revocation completes while the lock
//! is held by someone else — which is exactly the unprotected window.
//!
//! The domain is a NON-root node deliberately: the node branch takes
//! `lock_nodes`, not `lock_workspaces`, so the only `lock_workspaces`
//! acquisition in the whole call is the one under test. (The workspace-root
//! branch takes it for its own membership write, which would mask the tail.)

use citadel_workspace_server_kernel::handlers::domain::async_ops::AsyncUserManagementOperations;
use citadel_workspace_server_kernel::WORKSPACE_ROOT_ID;
use citadel_workspace_types::structs::{
    DomainNode, DomainPermissions, NodeEntityType, Permission, User, UserRole,
};
use common::workspace_test_utils::{create_test_kernel, TEST_ADMIN_USER_ID};
use std::collections::{HashMap, HashSet};
use std::time::Duration;

fn office(id: &str, members: Vec<String>) -> DomainNode {
    DomainNode {
        id: id.to_string(),
        parent_id: Some(WORKSPACE_ROOT_ID.to_string()),
        entity_type: NodeEntityType::Child("Office".to_string()),
        depth: 1,
        name: format!("office-{id}"),
        description: String::new(),
        owner_id: TEST_ADMIN_USER_ID.to_string(),
        members,
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
async fn grant_revocation_waits_for_the_user_record_lock() {
    let kernel = create_test_kernel().await;
    let backend = &kernel.domain_operations.backend_tx_manager;

    let mut nodes = HashMap::new();
    nodes.insert(
        "office-a".to_string(),
        office("office-a", vec!["victim".to_string()]),
    );
    backend.save_nodes(&nodes).await.expect("seed node");

    let mut permissions = HashMap::new();
    permissions.insert(
        "office-a".to_string(),
        HashSet::from([Permission::ViewContent]),
    );
    backend
        .insert_user(
            "victim".to_string(),
            User {
                id: "victim".to_string(),
                name: "Victim".to_string(),
                role: UserRole::Member,
                permissions,
                metadata: HashMap::new(),
            },
        )
        .await
        .expect("seed victim");

    // Pose as "another user-record writer": hold the lock every such writer
    // takes across its read-modify-write.
    let guard = backend.lock_workspaces().await;

    let ops = kernel.domain_operations.clone();
    let removal = tokio::spawn(async move {
        ops.remove_user_from_domain(TEST_ADMIN_USER_ID, "victim", "office-a")
            .await
    });

    // Give the removal ample time to run all the way to the revocation. The
    // in-memory backend makes everything before it effectively instantaneous.
    tokio::time::sleep(Duration::from_millis(300)).await;

    let user = backend
        .get_user("victim")
        .await
        .expect("read victim")
        .expect("victim exists");
    assert!(
        user.permissions.contains_key("office-a"),
        "the grant revocation completed while another writer held \
         lock_workspaces — its read-modify-write is running unlocked, \
         which is the lost-update window"
    );

    // Release the lock: the removal must now finish and the grant must go.
    drop(guard);
    removal
        .await
        .expect("task join")
        .expect("removal succeeds once the lock is free");

    let user = backend
        .get_user("victim")
        .await
        .expect("read victim")
        .expect("victim exists");
    assert!(
        !user.permissions.contains_key("office-a"),
        "after the removal returns, the grant is revoked"
    );
    let nodes = backend.get_all_nodes().await.expect("read nodes");
    assert!(
        !nodes["office-a"].members.contains(&"victim".to_string()),
        "and the membership is gone too"
    );
}
