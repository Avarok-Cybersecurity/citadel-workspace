//! A hosted tenant's `[documents]` limits are the native server's.
//!
//! The tenant worker writes each Durable Object's kernel.toml itself
//! (`deploy/tenant-worker/control/provisioning.mjs`, `kernelConfig`), as string lines, so its
//! `[documents]` table is a second copy of `docker/workspace-server/kernel.toml`'s. Nothing tied
//! the two: a limit changed in one file would leave hosted tenants on the other value with every
//! test green. This parses the worker's copy with the kernel's own types and compares it whole.

use citadel_workspace_server_kernel::kernel::documents::DocumentsConfig;
use common::documents_test_utils::shipped_documents_config;

/// The `[documents]` lines `kernelConfig` pushes, as the TOML they become.
fn provisioned_documents_section() -> String {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../deploy/tenant-worker/control/provisioning.mjs");
    let source = std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("cannot read {}: {e}", path.display()));
    let start = source
        .find("\"[documents]\",")
        .expect("kernelConfig pushes no [documents] table");
    let block = &source[start..];
    let end = block.find(");").expect("the [documents] lines never close");
    block[..end]
        .lines()
        .map(str::trim)
        .filter_map(|line| line.strip_prefix('"')?.strip_suffix("\","))
        .collect::<Vec<_>>()
        .join("\n")
}

fn provisioned_documents_config() -> DocumentsConfig {
    let table: toml::Value = toml::from_str(&provisioned_documents_section())
        .expect("the provisioned [documents] parses");
    table
        .get("documents")
        .cloned()
        .expect("a [documents] table")
        .try_into()
        .expect("the provisioned [documents] holds every limit")
}

#[test]
fn a_hosted_tenant_gets_the_shipped_document_limits() {
    assert_eq!(provisioned_documents_config(), shipped_documents_config());
}
