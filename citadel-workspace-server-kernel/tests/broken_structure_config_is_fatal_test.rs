//! A configured workspace structure that cannot be read must stop the boot.
//!
//! The seed-pending marker is armed only when a structure actually loaded, so a
//! first boot that swallowed a load error would record neither marker and the
//! workspace would be stamped seeded with no offices, permanently. The single
//! JSON-file form (`workspace_structure`) is gone: a config naming it is refused.

use citadel_workspace_server_kernel::config::ServerConfig;
use citadel_workspace_server_kernel::resolve_workspace_structure;

/// A config naming `content_dir` as its structure, or none.
fn config_naming(content_dir: Option<&str>) -> ServerConfig {
    ServerConfig {
        bind_addr: "127.0.0.1:12349".to_string(),
        backend: None,
        data_dir: None,
        workspace_master_password: "test-password".to_string(),
        content_base_dir: content_dir.map(str::to_string),
        file_transfer: None,
        allow_first_connect_admin: None,
        workspace_name: None,
        require_platform_terms: Some(false),
        documents: None,
        secure_links_per_member: Some(5),
        secure_links_pool: Some(0),
        chat_documents_limit: Some(0),
        chat_attachment_max_bytes: Some(0),
        chat_attachment_max_files_per_node: Some(0),
        sign_in: None,
        app_server_egress: None,
        stun_servers: None,
        path_policy: None,
        identity: None,
    }
}

fn temp_dir(name: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!("citadel-boot-{name}-{}", std::process::id()));
    std::fs::create_dir_all(&dir).expect("create temp dir");
    dir
}

#[test]
fn a_missing_content_directory_refuses_to_boot() {
    let dir = temp_dir("missing");
    assert!(
        resolve_workspace_structure(&config_naming(Some("does-not-exist")), Some(&dir)).is_err(),
        "a configured structure that cannot be read is a configuration error",
    );
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn the_removed_structure_file_key_is_refused() {
    let err = toml::from_str::<ServerConfig>(
        "bind_addr = \"127.0.0.1:0\"\nworkspace_structure = \"./workspaces.json\"",
    )
    .expect_err("a config naming the removed key is refused");
    assert!(err.to_string().contains("workspace_structure"), "{err}");
}

#[test]
fn a_config_naming_no_structure_still_boots() {
    // The guard must not turn "no structure configured" into an error: that is
    // the ordinary case for a server that seeds nothing.
    let dir = temp_dir("none");
    let resolved = resolve_workspace_structure(&config_naming(None), Some(&dir));
    assert!(
        resolved.is_ok(),
        "a server with no configured structure must still boot"
    );
    assert!(
        resolved.expect("ok").is_none(),
        "and it resolves to no structure"
    );
    let _ = std::fs::remove_dir_all(&dir);
}
