//! # A workspace created with an icon starts with it
//!
//! Owner, 2026-09-27: the icon should be choosable while creating the workspace. /create carries
//! it to the tenant, which writes it into kernel.toml as `workspace_logo`
//! (deploy/tenant-worker/control/provisioning.mjs). These tests pin the kernel's half, as
//! `the_root_workspace_takes_the_configured_name` does for the name:
//! - the key parses, and an icon the workspace could not show is a configuration error, not
//!   something to fall back from;
//! - a fresh store seeds it into the root's metadata under `logo`;
//! - an existing root is given it only if it has never had one. An icon an administrator set,
//!   or cleared, is theirs.

use citadel_sdk::prelude::StackedRatchet;
use citadel_workspace_server_kernel::config::ServerConfig;
use citadel_workspace_server_kernel::kernel::async_kernel::AsyncWorkspaceServerKernel;
use citadel_workspace_server_kernel::{resolve_workspace_logo, WORKSPACE_ROOT_ID};

type Kernel = AsyncWorkspaceServerKernel<StackedRatchet>;

const MASTER_PASSWORD: &str = "test-master-password";
/// A PNG signature and nothing else: the smallest icon the rules accept.
const ICON: &str = "data:image/png;base64,iVBORw0KGgo=";
const OTHER_ICON: &str = "data:image/png;base64,iVBORw0KGgoA";

fn config(logo_line: &str) -> ServerConfig {
    toml::from_str(&format!(
        "bind_addr = \"127.0.0.1:0\"\nworkspace_master_password = \"{MASTER_PASSWORD}\"\n{logo_line}"
    ))
    .expect("kernel.toml parses")
}

fn kernel_with(logo: Option<&str>) -> Kernel {
    let mut kernel = Kernel::new(None);
    kernel.set_workspace_logo(logo.map(str::to_string));
    kernel
}

async fn root_logo(kernel: &Kernel) -> serde_json::Value {
    let workspace = kernel
        .domain_operations
        .backend_tx_manager
        .get_workspace(WORKSPACE_ROOT_ID)
        .await
        .expect("read workspace")
        .expect("root workspace exists");
    if workspace.metadata.is_empty() {
        return serde_json::Value::Null;
    }
    let meta: serde_json::Value =
        serde_json::from_slice(&workspace.metadata).expect("metadata is JSON");
    meta.get("logo").cloned().unwrap_or(serde_json::Value::Null)
}

async fn set_root_metadata(kernel: &Kernel, metadata: serde_json::Value) {
    let backend = &kernel.domain_operations.backend_tx_manager;
    let mut workspace = backend
        .get_workspace(WORKSPACE_ROOT_ID)
        .await
        .unwrap()
        .unwrap();
    workspace.metadata = serde_json::to_vec(&metadata).unwrap();
    backend
        .insert_workspace(WORKSPACE_ROOT_ID.to_string(), workspace)
        .await
        .unwrap();
}

#[test]
fn the_configured_icon_parses_and_an_unshowable_one_is_an_error() {
    let parsed = config(&format!("workspace_logo = \"{ICON}\""));
    assert_eq!(
        resolve_workspace_logo(&parsed).expect("valid"),
        Some(ICON.to_string())
    );
    assert_eq!(
        resolve_workspace_logo(&config("")).expect("absent is fine"),
        None
    );
    let svg = config("workspace_logo = \"data:image/svg+xml;base64,PHN2Zy8+\"");
    assert!(
        resolve_workspace_logo(&svg).is_err(),
        "an SVG icon was accepted from the config"
    );
}

#[tokio::test]
async fn a_fresh_store_starts_with_the_configured_icon() {
    let kernel = kernel_with(Some(ICON));
    kernel.inject_admin_user(MASTER_PASSWORD).await.unwrap();
    assert_eq!(root_logo(&kernel).await, serde_json::json!(ICON));
}

#[tokio::test]
async fn an_existing_root_gets_it_only_if_it_never_had_one() {
    let kernel = kernel_with(Some(ICON));
    kernel.inject_admin_user(MASTER_PASSWORD).await.unwrap();

    // Never had one (a store from before icons): given it on the next boot, keeping the rest.
    set_root_metadata(&kernel, serde_json::json!({ "initialized": true })).await;
    kernel.inject_admin_user(MASTER_PASSWORD).await.unwrap();
    assert_eq!(root_logo(&kernel).await, serde_json::json!(ICON));

    // An administrator's own icon, and an administrator's clear, both stand.
    set_root_metadata(&kernel, serde_json::json!({ "logo": OTHER_ICON })).await;
    kernel.inject_admin_user(MASTER_PASSWORD).await.unwrap();
    assert_eq!(root_logo(&kernel).await, serde_json::json!(OTHER_ICON));
    set_root_metadata(&kernel, serde_json::json!({ "logo": null })).await;
    kernel.inject_admin_user(MASTER_PASSWORD).await.unwrap();
    assert_eq!(root_logo(&kernel).await, serde_json::Value::Null);
}

#[tokio::test]
async fn no_configured_icon_leaves_the_root_without_one() {
    let kernel = kernel_with(None);
    kernel.inject_admin_user(MASTER_PASSWORD).await.unwrap();
    assert_eq!(root_logo(&kernel).await, serde_json::Value::Null);
}
