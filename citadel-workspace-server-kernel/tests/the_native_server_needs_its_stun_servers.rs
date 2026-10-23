//! A native server reads its STUN servers from `kernel.toml` and will not start without them:
//! the SDK has no default list, and a default here would report the server's address to third
//! parties nobody chose.

use citadel_workspace_server_kernel::config::ServerConfig;
use citadel_workspace_server_kernel::network::native_stun_servers;
use citadel_workspace_server_kernel::run_server_with_base_path;
use common::documents_test_utils::shipped_documents_section;
use common::production_server::{sign_in_dir, sign_in_without_admission};

fn repo(path: &str) -> String {
    std::fs::read_to_string(format!("{}/../{path}", env!("CARGO_MANIFEST_DIR"))).expect(path)
}

#[test]
fn the_shipped_kernel_toml_names_a_valid_list() {
    let shipped: ServerConfig =
        toml::from_str(&repo("docker/workspace-server/kernel.toml")).expect("parses");
    let servers = native_stun_servers(shipped.stun_servers.as_deref())
        .expect("the shipped kernel.toml's stun_servers is refused");
    assert!(servers.as_slice().len() >= 3);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn startup_fails_without_them() {
    // Every other required key present, so the refusal can only be the missing list.
    let config: ServerConfig = toml::from_str(&format!(
        "bind_addr = \"127.0.0.1:0\"\nworkspace_master_password = \"a-test-master-password\"\n\
         require_platform_terms = false\nsecure_links_per_member = 5\nsecure_links_pool = 0\n\
         {}\n{}",
        sign_in_without_admission(&sign_in_dir()),
        shipped_documents_section()
    ))
    .expect("config");
    let refused = tokio::time::timeout(
        std::time::Duration::from_secs(30),
        run_server_with_base_path(config, None),
    )
    .await
    .expect("refuses at once rather than serving");
    let error = format!(
        "{:?}",
        refused.expect_err("a server without stun_servers started")
    );
    assert!(error.contains("stun_servers"), "{error}");
}
