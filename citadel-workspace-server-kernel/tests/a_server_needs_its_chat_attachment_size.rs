//! Every server reads the largest chat file it keeps from `kernel.toml`, and will not build its
//! kernel without it: a default would be a size nobody chose. A hosted tenant's kernel.toml is
//! written by its control plane (`deploy/tenant-worker/control/provisioning.mjs`), which says it.

use citadel_workspace_server_kernel::config::ServerConfig;
use citadel_workspace_server_kernel::resolve_chat_attachment_max_bytes;

fn config(extra: &str) -> ServerConfig {
    toml::from_str(&format!("bind_addr = \"127.0.0.1:0\"\n{extra}")).expect("config")
}

#[test]
fn the_key_is_required_and_zero_keeps_none() {
    assert!(resolve_chat_attachment_max_bytes(&config("")).is_err());
    assert_eq!(
        resolve_chat_attachment_max_bytes(&config("chat_attachment_max_bytes = 0")).unwrap(),
        0
    );
}

#[test]
fn the_shipped_config_sets_it() {
    let shipped = std::fs::read_to_string(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../docker/workspace-server/kernel.toml"),
    )
    .expect("the shipped kernel.toml");
    let shipped: ServerConfig = toml::from_str(&shipped).expect("parses");
    assert_eq!(
        resolve_chat_attachment_max_bytes(&shipped).unwrap(),
        25 * 1024 * 1024
    );
}
