//! Creating a second workspace must not make you an administrator of the first.
//!
//! `user.role` is a single GLOBAL field — `is_admin` reads it and never asks
//! which workspace — and `create_workspace` set it to `Admin` for every
//! creator, bootstrap or not.
//!
//! `Permission::for_role` gives an Owner `CreateWorkspace`, so an Owner holding
//! the master password could create a throwaway workspace and come back a
//! global Admin, carrying the `ConfigureSystem` that `for_role` deliberately
//! withholds from Owner. The role door (`no_one_grants_a_role_above_their_own`)
//! and the permission door (`no_one_grants_a_permission_they_lack`) were both
//! closed against exactly that; this was a third one.
//!
//! The creator now gets full authority over the workspace they created, scoped
//! to it. The bootstrap promotion survives, because with no workspace in
//! existence that account IS the administrator — and that case is asserted
//! here, since a fix that broke it would otherwise look like a pass.

use citadel_workspace_server_kernel::handlers::domain::async_ops::AsyncWorkspaceOperations;
use citadel_workspace_types::structs::{Permission, UserRole};
use common::member_test_utils::{insert_user_with_role, join_root, GateKernel as Kernel};
use common::workspace_test_utils::{create_test_kernel, TEST_ADMIN_PASSWORD};

async fn role_of(kernel: &Kernel, id: &str) -> UserRole {
    kernel
        .domain_operations
        .backend_tx_manager
        .get_user(id)
        .await
        .expect("read user")
        .expect("user exists")
        .role
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_owner_creating_another_workspace_does_not_become_a_global_admin() {
    let kernel = create_test_kernel().await;
    insert_user_with_role(&kernel, "owner", UserRole::Owner).await;
    join_root(&kernel, "owner").await;

    let created = kernel
        .domain_operations
        .create_workspace(
            "owner",
            "second",
            "an additional workspace",
            None,
            TEST_ADMIN_PASSWORD.to_string(),
        )
        .await;

    // Vacuity guard: if creation were refused, every assertion below would be
    // skipped and this file would pass while testing nothing.
    created.expect("an Owner holding the master password may create a workspace");
    {
        assert_eq!(
            role_of(&kernel, "owner").await,
            UserRole::Owner,
            "creating a workspace must not rewrite the global role: is_admin reads it \
             and never asks which workspace",
        );
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_creator_still_holds_full_authority_over_what_they_created() {
    let kernel = create_test_kernel().await;
    insert_user_with_role(&kernel, "owner", UserRole::Owner).await;
    join_root(&kernel, "owner").await;

    let created = kernel
        .domain_operations
        .create_workspace(
            "owner",
            "second",
            "an additional workspace",
            None,
            TEST_ADMIN_PASSWORD.to_string(),
        )
        .await;

    let workspace = created.expect("creation must succeed or the assertions below never run");
    {
        let user = kernel
            .domain_operations
            .backend_tx_manager
            .get_user("owner")
            .await
            .expect("read user")
            .expect("user exists");
        let scoped = user
            .permissions
            .get(&workspace.id)
            .expect("the creator holds a grant on the workspace they created");
        assert!(
            Permission::has_permission(scoped, &Permission::EditTreeStructure),
            "scoped authority must be real, or the fix has only removed rights",
        );
        assert!(
            !Permission::has_permission(
                user.permissions
                    .get(citadel_workspace_server_kernel::WORKSPACE_ROOT_ID)
                    .unwrap_or(&Default::default()),
                &Permission::ConfigureSystem
            ),
            "and it must not have leaked onto the root workspace",
        );
    }
}
