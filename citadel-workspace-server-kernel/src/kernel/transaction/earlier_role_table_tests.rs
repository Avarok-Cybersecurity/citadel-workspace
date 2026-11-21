//! A role table stored by an earlier server, read by the kernel: refused, not upgraded.
//!
//! The record is written as raw JSON, as an earlier server wrote it, which only a test inside
//! the crate can do.

use crate::kernel::secure_links::test_support::kernel_with_member;
use crate::WORKSPACE_ROOT_ID;
use citadel_workspace_types::roles::MEMBER_ROLE_ID;

#[tokio::test]
async fn a_role_table_from_an_earlier_server_is_refused() {
    let kernel = kernel_with_member("reader").await;
    let backend = &kernel.domain_operations.backend_tx_manager;
    let role = serde_json::json!({ "id": MEMBER_ROLE_ID, "name": "Member", "permissions": ["ViewContent"], "position": 200, "color": null });
    for earlier in [
        serde_json::json!({ "roles": [role.clone()], "default_role_id": MEMBER_ROLE_ID }),
        serde_json::json!({ "roles": [role.clone()], "default_role_id": MEMBER_ROLE_ID, "version": 1 }),
    ] {
        backend
            .backend_save("citadel_workspace.roles.workspace-root", &earlier)
            .await
            .expect("earlier table");
        assert!(
            backend.get_roles(WORKSPACE_ROOT_ID).await.is_err(),
            "read an earlier server's role table: {earlier}"
        );
    }
}

#[tokio::test]
async fn a_table_this_server_wrote_is_read() {
    let kernel = kernel_with_member("reader").await;
    let backend = &kernel.domain_operations.backend_tx_manager;
    let table = backend.get_roles(WORKSPACE_ROOT_ID).await.unwrap();
    backend.save_roles(WORKSPACE_ROOT_ID, &table).await.unwrap();
    assert_eq!(backend.get_roles(WORKSPACE_ROOT_ID).await.unwrap(), table);
}
