//! Every server reads what a node's chat keeps (its largest file and how many files) from
//! `kernel.toml`, and will not build its kernel without both: a default would be a limit nobody
//! chose. A hosted tenant's kernel.toml is written by its control plane
//! (`deploy/tenant-worker/control/provisioning.mjs`), which says them.

use citadel_workspace_server_kernel::config::ServerConfig;
use citadel_workspace_server_kernel::kernel::chat_attachments::ChatAttachmentLimits;
use citadel_workspace_server_kernel::resolve_chat_attachment_limits;

fn config(extra: &str) -> ServerConfig {
    toml::from_str(&format!("bind_addr = \"127.0.0.1:0\"\n{extra}")).expect("config")
}

#[test]
fn both_keys_are_required_and_zero_keeps_none() {
    assert!(resolve_chat_attachment_limits(&config("")).is_err());
    assert!(resolve_chat_attachment_limits(&config("chat_attachment_max_bytes = 0")).is_err());
    assert!(
        resolve_chat_attachment_limits(&config("chat_attachment_max_files_per_node = 9")).is_err()
    );
    assert_eq!(
        resolve_chat_attachment_limits(&config(
            "chat_attachment_max_bytes = 0\nchat_attachment_max_files_per_node = 9"
        ))
        .unwrap(),
        ChatAttachmentLimits {
            max_bytes: 0,
            max_files_per_node: 9
        }
    );
}

#[test]
fn the_shipped_config_sets_them() {
    let shipped = std::fs::read_to_string(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../docker/workspace-server/kernel.toml"),
    )
    .expect("the shipped kernel.toml");
    let shipped: ServerConfig = toml::from_str(&shipped).expect("parses");
    assert_eq!(
        resolve_chat_attachment_limits(&shipped).unwrap(),
        ChatAttachmentLimits {
            max_bytes: 25 * 1024 * 1024,
            max_files_per_node: 2048
        }
    );
}
