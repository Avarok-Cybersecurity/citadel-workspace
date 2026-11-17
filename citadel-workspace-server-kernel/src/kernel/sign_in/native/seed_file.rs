//! A secret seed on disk, raw bytes in a file only its owner can read: the OPRF seed, and the
//! server identity key's seed (`kernel::server_identity::key_file`).
//!
//! Made once, by an explicit init command (`--init-sign-in-seed`, `--init-server-key`), and never
//! by the server: a new OPRF seed silently locks out every post-quantum account and a new
//! identity key makes every client that pinned the old one refuse the server, both worse than a
//! server that refuses to start (the worker's control/oprf-seed.mjs makes the same refusal). So
//! reading never repairs anything, and creating never overwrites.

use crate::kernel::sign_in::pq::OPRF_SEED_BYTES;
use std::io::{Read, Write};
use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt, PermissionsExt};
use std::path::Path;
use zeroize::Zeroizing;

/// Any bit here lets someone other than the owner read or change the seed.
const NOT_OWNER_ONLY: u32 = 0o077;

/// Which seed a file holds, for the messages that name it.
pub struct SeedKind {
    /// "sign-in seed", "server key seed".
    pub what: &'static str,
    /// The command that makes one.
    pub init_flag: &'static str,
    /// Why one is never replaced.
    pub never_replace: &'static str,
    /// What refuses to start without it.
    pub refuses: &'static str,
}

/// kernel.toml `[sign_in] oprf_seed_file`.
pub const SIGN_IN_SEED: SeedKind = SeedKind {
    what: "sign-in seed",
    init_flag: "--init-sign-in-seed",
    never_replace: "a new one locks out every post-quantum account",
    refuses: "sign-in",
};

/// The `N`-byte seed at `path`, or why it cannot be used. Never the seed in an error.
pub fn read_seed_file<const N: usize>(
    kind: &SeedKind,
    path: &Path,
) -> Result<Zeroizing<[u8; N]>, String> {
    let (what, shown) = (kind.what, path.display());
    let meta = std::fs::symlink_metadata(path).map_err(|e| {
        format!(
            "the {what} {shown} cannot be read ({e}); create it once with {} {shown}",
            kind.init_flag
        )
    })?;
    if !meta.file_type().is_file() {
        return Err(format!("the {what} {shown} is not a regular file"));
    }
    let mode = meta.permissions().mode() & 0o777;
    if mode & NOT_OWNER_ONLY != 0 {
        return Err(format!(
            "the {what} {shown} has mode {mode:o}; it must be 600 (chmod 600 {shown})"
        ));
    }
    let file = std::fs::File::open(path).map_err(|e| format!("the {what} {shown}: {e}"))?;
    let mut bytes = Zeroizing::new(Vec::with_capacity(N + 1));
    file.take(N as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| format!("the {what} {shown}: {e}"))?;
    let seed: [u8; N] = bytes.as_slice().try_into().map_err(|_| {
        format!(
            "the {what} {shown} is not {N} bytes; refusing to start {}",
            kind.refuses
        )
    })?;
    Ok(Zeroizing::new(seed))
}

/// Creates a new `N`-byte seed at `path` from the OS CSPRNG, mode 0600, and its directory (mode
/// 0700) if there is none. Refuses if anything is already at `path`.
pub fn create_seed_file<const N: usize>(kind: &SeedKind, path: &Path) -> Result<(), String> {
    let (what, shown) = (kind.what, path.display());
    if !path.is_absolute() {
        return Err(format!("the {what} path must be absolute, got {shown}"));
    }
    if let Some(dir) = path.parent() {
        std::fs::DirBuilder::new()
            .recursive(true)
            .mode(0o700)
            .create(dir)
            .map_err(|e| format!("cannot create {}: {e}", dir.display()))?;
    }
    let mut seed = Zeroizing::new([0u8; N]);
    getrandom::fill(seed.as_mut()).map_err(|e| format!("the OS CSPRNG failed: {e}"))?;
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(path)
        .map_err(|e| match e.kind() {
            std::io::ErrorKind::AlreadyExists => format!(
                "{shown} already exists; refusing to replace a {what} ({})",
                kind.never_replace
            ),
            _ => format!("cannot create {shown}: {e}"),
        })?;
    let written = file.write_all(seed.as_ref()).and_then(|()| file.sync_all());
    if let Err(e) = written {
        return Err(match std::fs::remove_file(path) {
            Ok(()) => format!("cannot write {shown}: {e}"),
            Err(left) => {
                format!("cannot write {shown}: {e}; the partial file remains ({left}): delete it")
            }
        });
    }
    Ok(())
}

/// The OPRF seed at `path`.
pub fn read_seed(path: &Path) -> Result<Zeroizing<[u8; OPRF_SEED_BYTES]>, String> {
    read_seed_file(&SIGN_IN_SEED, path)
}

/// `--init-sign-in-seed`.
pub fn init_sign_in_seed(path: &Path) -> Result<(), String> {
    create_seed_file::<OPRF_SEED_BYTES>(&SIGN_IN_SEED, path)
}
