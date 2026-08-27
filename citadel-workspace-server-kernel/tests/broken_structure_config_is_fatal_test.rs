//! A configured workspace structure that cannot be read must stop the boot.
//!
//! The deprecated `workspace_structure` JSON path logged its load failure at
//! INFO ("Warning: … Continuing without pre-configured structure") and carried
//! on with no structure. That looks harmless and is not.
//!
//! The seed-pending marker is armed only when a structure actually loaded — for
//! a good reason, documented at its call site: arming it unconditionally would
//! let a later deploy that ADDS a structure inject defaults into a workspace
//! that has been live for weeks. So a first boot that swallowed this error
//! records NEITHER marker. The next boot sees no marker at all, takes the
//! "established workspace predates the seed markers" back-fill branch, and
//! stamps it seeded.
//!
//! The workspace then has no offices, permanently, recoverable only by wiping
//! the backend — announced by one info line. The recommended `content_base_dir`
//! branch was already fatal; only the deprecated one swallowed it.

use citadel_workspace_server_kernel::config::ServerConfig;
use citadel_workspace_server_kernel::resolve_workspace_structure;
use std::io::Write;

/// Writes a kernel.toml naming a structure file, and returns the config path.
fn config_naming(structure_file: Option<&str>) -> ServerConfig {
    ServerConfig {
        bind_addr: "127.0.0.1:12349".to_string(),
        dangerous_skip_cert_verification: None,
        backend: None,
        data_dir: None,
        workspace_master_password: "test-password".to_string(),
        workspace_structure: structure_file.map(str::to_string),
        content_base_dir: None,
        file_transfer: None,
    }
}

fn temp_dir(name: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!("citadel-boot-{name}-{}", std::process::id()));
    std::fs::create_dir_all(&dir).expect("create temp dir");
    dir
}

#[test]
fn an_unparseable_structure_file_refuses_to_boot() {
    let dir = temp_dir("unparseable");
    let mut f = std::fs::File::create(dir.join("workspaces.json")).expect("create structure");
    f.write_all(b"{ this is not json").expect("write structure");

    let result = resolve_workspace_structure(&config_naming(Some("workspaces.json")), Some(&dir));

    assert!(
        result.is_err(),
        "a configured structure that cannot be read is a configuration error; \
         booting without it permanently stamps the workspace seeded",
    );
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn a_missing_structure_file_refuses_to_boot() {
    let dir = temp_dir("missing");

    assert!(
        resolve_workspace_structure(&config_naming(Some("does-not-exist.json")), Some(&dir))
            .is_err(),
        "a named structure file that is not there is the same class of error",
    );
    let _ = std::fs::remove_dir_all(&dir);
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
