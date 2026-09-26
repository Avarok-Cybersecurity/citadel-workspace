//! # The root workspace takes the name its operator configured
//!
//! Every hosted workspace was created with a name (`display_name` at /create),
//! and every one of them showed as "Root Workspace": the control plane stored
//! the name and never passed it on, and the kernel seeded the root workspace
//! with a hard-coded name. So every hosted org looked the same in the workspace
//! switcher.
//!
//! `ServerConfig::workspace_name` carries the name to the kernel. These tests
//! pin what the kernel does with it at boot (`inject_admin_user`, which is what
//! `on_start` runs): a fresh store is seeded with it; a store still wearing the
//! default is renamed to it once (a tenant whose store predates the fix); a
//! name an administrator chose is never overwritten; and no configured name
//! leaves a self-hosted server exactly as it was.

use citadel_sdk::prelude::StackedRatchet;
use citadel_workspace_server_kernel::config::ServerConfig;
use citadel_workspace_server_kernel::kernel::async_kernel::AsyncWorkspaceServerKernel;
use citadel_workspace_server_kernel::{
    resolve_workspace_name, DEFAULT_ROOT_WORKSPACE_NAME, WORKSPACE_ROOT_ID,
};
use citadel_workspace_types::structs::Domain;

type Kernel = AsyncWorkspaceServerKernel<StackedRatchet>;

const MASTER_PASSWORD: &str = "test-master-password";

fn kernel_named(name: Option<&str>) -> Kernel {
    let mut kernel = Kernel::new(None);
    kernel.set_workspace_name(name.map(str::to_string));
    kernel
}

/// The root workspace's name as both records hold it: the workspace and the
/// domain wrapping it. A rename that reached one and not the other would show
/// one name in the switcher and another in the tree.
async fn root_names(kernel: &Kernel) -> (String, String) {
    let backend = &kernel.domain_operations.backend_tx_manager;
    let workspace = backend
        .get_workspace(WORKSPACE_ROOT_ID)
        .await
        .expect("read workspace")
        .expect("root workspace exists");
    let Domain::Workspace { workspace: wrapped } = kernel
        .get_domain(WORKSPACE_ROOT_ID)
        .await
        .expect("read domain")
        .expect("root domain exists");
    (workspace.name, wrapped.name)
}

/// What an administrator renaming the workspace leaves in the store.
async fn rename_as_an_admin_would(kernel: &Kernel, name: &str) {
    let backend = &kernel.domain_operations.backend_tx_manager;
    let mut workspace = backend
        .get_workspace(WORKSPACE_ROOT_ID)
        .await
        .unwrap()
        .unwrap();
    workspace.name = name.to_string();
    backend
        .insert_workspace(WORKSPACE_ROOT_ID.to_string(), workspace.clone())
        .await
        .unwrap();
    backend
        .insert_domain(
            WORKSPACE_ROOT_ID.to_string(),
            Domain::Workspace { workspace },
        )
        .await
        .unwrap();
}

fn both(name: &str) -> (String, String) {
    (name.to_string(), name.to_string())
}

#[tokio::test]
async fn a_fresh_store_is_seeded_with_the_configured_name() {
    let kernel = kernel_named(Some("Admin Lab"));
    kernel.inject_admin_user(MASTER_PASSWORD).await.unwrap();
    assert_eq!(root_names(&kernel).await, both("Admin Lab"));
}

#[tokio::test]
async fn a_store_still_wearing_the_default_is_renamed_to_the_configured_name() {
    let mut kernel = kernel_named(None);
    kernel.inject_admin_user(MASTER_PASSWORD).await.unwrap();
    assert_eq!(root_names(&kernel).await, both(DEFAULT_ROOT_WORKSPACE_NAME));

    // The same store, booted again once the tenant has been re-provisioned.
    kernel.set_workspace_name(Some("Admin Lab".to_string()));
    kernel.inject_admin_user(MASTER_PASSWORD).await.unwrap();
    assert_eq!(root_names(&kernel).await, both("Admin Lab"));
}

#[tokio::test]
async fn a_name_an_administrator_chose_is_never_overwritten() {
    let mut kernel = kernel_named(Some("Admin Lab"));
    kernel.inject_admin_user(MASTER_PASSWORD).await.unwrap();
    rename_as_an_admin_would(&kernel, "Ops Team").await;

    kernel.inject_admin_user(MASTER_PASSWORD).await.unwrap();
    assert_eq!(root_names(&kernel).await, both("Ops Team"));

    // Nor by a different configured name: the configuration names a new
    // workspace, it does not own an established one.
    kernel.set_workspace_name(Some("Something Else".to_string()));
    kernel.inject_admin_user(MASTER_PASSWORD).await.unwrap();
    assert_eq!(root_names(&kernel).await, both("Ops Team"));
}

#[tokio::test]
async fn no_configured_name_keeps_the_default_and_an_admins_rename() {
    let kernel = kernel_named(None);
    kernel.inject_admin_user(MASTER_PASSWORD).await.unwrap();
    assert_eq!(root_names(&kernel).await, both(DEFAULT_ROOT_WORKSPACE_NAME));

    rename_as_an_admin_would(&kernel, "Ops Team").await;
    kernel.inject_admin_user(MASTER_PASSWORD).await.unwrap();
    assert_eq!(root_names(&kernel).await, both("Ops Team"));
}

fn config_with(name: Option<&str>) -> ServerConfig {
    toml::from_str(&match name {
        Some(n) => format!(
            "bind_addr = \"127.0.0.1:0\"\nworkspace_name = {}",
            toml::Value::String(n.to_string())
        ),
        None => "bind_addr = \"127.0.0.1:0\"".to_string(),
    })
    .expect("parse kernel.toml")
}

#[test]
fn the_configured_name_is_read_from_kernel_toml() {
    assert_eq!(
        resolve_workspace_name(&config_with(Some("Admin Lab"))).unwrap(),
        Some("Admin Lab".to_string())
    );
    assert_eq!(
        resolve_workspace_name(&config_with(Some("  Admin Lab  "))).unwrap(),
        Some("Admin Lab".to_string())
    );
    assert_eq!(resolve_workspace_name(&config_with(None)).unwrap(), None);
}

#[test]
fn a_configured_name_that_cannot_be_shown_refuses_to_boot() {
    for bad in ["", "   ", "tab\there", "nul\u{0}", &"x".repeat(65)] {
        assert!(
            resolve_workspace_name(&config_with(Some(bad))).is_err(),
            "{bad:?} must be refused"
        );
    }
    assert!(resolve_workspace_name(&config_with(Some(&"x".repeat(64)))).is_ok());
}
