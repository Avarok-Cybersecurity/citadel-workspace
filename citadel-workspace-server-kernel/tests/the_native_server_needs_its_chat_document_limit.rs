//! A native server reads its chat-document limit from `kernel.toml`, and will not start without
//! it: it has no plan to read it from, and a default would be a limit nobody chose.

use citadel_workspace_server_kernel::config::ServerConfig;
use citadel_workspace_server_kernel::{resolve_chat_document_limit, run_server_with_base_path};

fn config(extra: &str) -> ServerConfig {
    toml::from_str(&format!(
        "bind_addr = \"127.0.0.1:0\"\nworkspace_master_password = \"a-test-master-password\"\n\
         require_platform_terms = false\nsecure_links_per_member = 5\nsecure_links_pool = 0\n{extra}"
    ))
    .expect("config")
}

#[test]
fn the_key_is_required_and_zero_is_a_limit() {
    assert!(resolve_chat_document_limit(&config("")).is_err());
    assert_eq!(
        resolve_chat_document_limit(&config("chat_documents_limit = 0")).unwrap(),
        0
    );
    assert_eq!(
        resolve_chat_document_limit(&config("chat_documents_limit = 1000")).unwrap(),
        1000
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn startup_fails_without_it() {
    let refused = tokio::time::timeout(
        std::time::Duration::from_secs(30),
        run_server_with_base_path(config(""), None),
    )
    .await
    .expect("refuses at once rather than serving");
    let error = format!(
        "{:?}",
        refused.expect_err("a server without its chat-document limit started")
    );
    assert!(error.contains("chat_documents_limit"), "{error}");
}

#[test]
fn the_shipped_config_sets_it() {
    let shipped = std::fs::read_to_string(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../docker/workspace-server/kernel.toml"),
    )
    .expect("the shipped kernel.toml");
    let shipped: ServerConfig = toml::from_str(&shipped).expect("parses");
    assert!(resolve_chat_document_limit(&shipped).is_ok());
}
