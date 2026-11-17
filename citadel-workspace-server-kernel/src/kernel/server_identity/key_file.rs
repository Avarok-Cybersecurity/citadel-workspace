//! A native server's identity: the key seed at `[identity] server_key_file`, made once by
//! `--init-server-key` and never by the server, and, for `discovery = "well_known"`, the
//! `/.well-known/citadel` document written to `[identity] well_known_file` for the operator's
//! HTTPS reverse proxy to serve.
//!
//! The server's I/O, and only at startup.

use super::config::{Discovery, IdentityConfig};
use super::ServerIdentity;
use crate::kernel::sign_in::native::seed_file::{create_seed_file, read_seed_file, SeedKind};
use citadel_identity::SEED_LEN;
use std::io::Write;
use std::path::{Path, PathBuf};

/// kernel.toml `[identity] server_key_file`.
pub const SERVER_KEY_SEED: SeedKind = SeedKind {
    what: "server key seed",
    init_flag: "--init-server-key",
    never_replace: "a new key makes every client that pinned this server refuse it",
    refuses: "the server",
};

/// `--init-server-key`.
pub fn init_server_key(path: &Path) -> Result<(), String> {
    create_seed_file::<SEED_LEN>(&SERVER_KEY_SEED, path)
}

fn absolute(key: &str, value: Option<&String>) -> Result<PathBuf, String> {
    let value = value.ok_or_else(|| format!("[identity] {key} is required"))?;
    let path = PathBuf::from(value);
    if !path.is_absolute() {
        return Err(format!(
            "[identity] {key} must be an absolute path, got {value:?}"
        ));
    }
    Ok(path)
}

/// Writes `bytes` to `path` through a sibling temporary file and a rename, so a proxy never
/// serves half a document.
fn replace_file(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let shown = path.display();
    let mut staged = path.as_os_str().to_owned();
    staged.push(".partial");
    let staged = PathBuf::from(staged);
    let written = std::fs::File::create(&staged)
        .and_then(|mut file| file.write_all(bytes).and_then(|()| file.sync_all()));
    written
        .and_then(|()| std::fs::rename(&staged, path))
        .map_err(|e| format!("cannot write /.well-known/citadel to {shown}: {e}"))
}

/// The identity a native server starts with, or the first reason it cannot start. A
/// `well_known` server's document is written to `well_known_file`, issued at `now_s`.
pub fn native_identity(
    config: Option<&IdentityConfig>,
    now_s: u64,
) -> Result<ServerIdentity, String> {
    let plan = super::config::plan(config)?;
    let config = config.ok_or("kernel.toml has no [identity] section")?;
    let key_path = absolute("server_key_file", config.server_key_file.as_ref())?;
    let document_path =
        match (plan.discovery, config.well_known_file.as_ref()) {
            (Discovery::WellKnown, file) => Some(absolute("well_known_file", file)?),
            (Discovery::Pinned, None) => None,
            (Discovery::Pinned, Some(_)) => return Err(
                "[identity] well_known_file is set but discovery = \"pinned\": nothing serves it"
                    .into(),
            ),
        };
    let seed = read_seed_file::<SEED_LEN>(&SERVER_KEY_SEED, &key_path)?;
    let canonical = plan.canonical.clone();
    let identity = ServerIdentity::new(plan, citadel_identity::ServerKey::from_seed(&seed));
    if let Some(path) = document_path {
        replace_file(&path, &identity.well_known_document(now_s)?)?;
        log::info!(target: "citadel", "Identity: {} (well_known), document written to {}", canonical, path.display());
    } else {
        log::warn!(target: "citadel", "Identity: {} (pinned): clients must be given this server's key fingerprint {} out of band, and show the domain as unverified until it matches", canonical, citadel_identity::fingerprint_grouped(identity.key().public_key()));
    }
    Ok(identity)
}
