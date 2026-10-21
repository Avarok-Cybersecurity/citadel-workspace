//! A native server reads its secure-link limits from `kernel.toml`, and will not start without
//! both: it has no plan to read them from, and a default would be a limit nobody chose.

use citadel_workspace_server_kernel::config::ServerConfig;
use citadel_workspace_server_kernel::kernel::secure_links::quota::{Limit, LinkQuota};
use citadel_workspace_server_kernel::{resolve_secure_link_quota, run_server_with_base_path};

fn config(extra: &str) -> ServerConfig {
    toml::from_str(&format!(
        "bind_addr = \"127.0.0.1:0\"\nworkspace_master_password = \"a-test-master-password\"\n\
         require_platform_terms = false\n{extra}"
    ))
    .expect("config")
}

#[test]
fn both_keys_are_required_and_zero_is_a_limit() {
    for extra in ["", "secure_links_per_member = 5", "secure_links_pool = 50"] {
        assert!(
            resolve_secure_link_quota(&config(extra)).is_err(),
            "{extra:?}"
        );
    }
    assert_eq!(
        resolve_secure_link_quota(&config(
            "secure_links_per_member = 0\nsecure_links_pool = 0"
        ))
        .unwrap(),
        LinkQuota {
            per_member: Limit::At(0),
            pool: Limit::At(0)
        }
    );
    assert_eq!(
        resolve_secure_link_quota(&config(
            "secure_links_per_member = 50\nsecure_links_pool = 100"
        ))
        .unwrap(),
        LinkQuota {
            per_member: Limit::At(50),
            pool: Limit::At(100)
        }
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn startup_fails_without_them() {
    let refused = tokio::time::timeout(
        std::time::Duration::from_secs(30),
        run_server_with_base_path(config("secure_links_per_member = 5"), None),
    )
    .await
    .expect("refuses at once rather than serving");
    let error = format!(
        "{:?}",
        refused.expect_err("a server without its link limits started")
    );
    assert!(error.contains("secure_links_pool"), "{error}");
}

#[test]
fn the_shipped_config_sets_them() {
    let shipped = std::fs::read_to_string(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../docker/workspace-server/kernel.toml"),
    )
    .expect("the shipped kernel.toml");
    let shipped: ServerConfig = toml::from_str(&shipped).expect("parses");
    assert!(resolve_secure_link_quota(&shipped).is_ok());
}
