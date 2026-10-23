//! A native server reads its path policy from `kernel.toml`'s `[path_policy]` and will not start
//! without it: the protocol refuses to build a server node with no policy, and a default here
//! would choose for the operator which paths carry their users' traffic.

use citadel_workspace_server_kernel::config::ServerConfig;
use citadel_workspace_server_kernel::run_server_with_base_path;
use common::documents_test_utils::shipped_documents_section;
use common::production_server::{sign_in_dir, sign_in_without_admission, test_stun_servers_toml};

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn startup_fails_without_it() {
    // Every other required key present, so the refusal can only be the missing section.
    let config: ServerConfig = toml::from_str(&format!(
        "bind_addr = \"127.0.0.1:0\"\nworkspace_master_password = \"a-test-master-password\"\n\
         require_platform_terms = false\nsecure_links_per_member = 5\nsecure_links_pool = 0\n\
         {}\n{}\n{}",
        test_stun_servers_toml(),
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
        refused.expect_err("a server without [path_policy] started")
    );
    assert!(error.contains("[path_policy]"), "{error}");
}
