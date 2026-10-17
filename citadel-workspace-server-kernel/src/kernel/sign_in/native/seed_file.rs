//! The OPRF seed on disk: 32 raw bytes in a file only its owner can read.
//!
//! Made once, by `--init-sign-in-seed`, and never by the server: a new seed silently locks out
//! every post-quantum account, which is worse than a server that refuses to start (the worker's
//! control/oprf-seed.mjs makes the same refusal). So reading never repairs anything, and
//! creating never overwrites.

use crate::kernel::sign_in::pq::OPRF_SEED_BYTES;
use std::io::{Read, Write};
use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt, PermissionsExt};
use std::path::Path;
use zeroize::Zeroizing;

/// Any bit here lets someone other than the owner read or change the seed.
const NOT_OWNER_ONLY: u32 = 0o077;

/// The seed at `path`, or why it cannot be used. Never the seed in an error.
pub fn read_seed(path: &Path) -> Result<Zeroizing<[u8; OPRF_SEED_BYTES]>, String> {
    let shown = path.display();
    let meta = std::fs::symlink_metadata(path).map_err(|e| {
        format!("the sign-in seed {shown} cannot be read ({e}); create it once with --init-sign-in-seed {shown}")
    })?;
    if !meta.file_type().is_file() {
        return Err(format!("the sign-in seed {shown} is not a regular file"));
    }
    let mode = meta.permissions().mode() & 0o777;
    if mode & NOT_OWNER_ONLY != 0 {
        return Err(format!(
            "the sign-in seed {shown} has mode {mode:o}; it must be 600 (chmod 600 {shown})"
        ));
    }
    let file = std::fs::File::open(path).map_err(|e| format!("the sign-in seed {shown}: {e}"))?;
    let mut bytes = Zeroizing::new(Vec::with_capacity(OPRF_SEED_BYTES + 1));
    file.take(OPRF_SEED_BYTES as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| format!("the sign-in seed {shown}: {e}"))?;
    let seed: [u8; OPRF_SEED_BYTES] = bytes.as_slice().try_into().map_err(|_| {
        format!(
            "the sign-in seed {shown} is not {OPRF_SEED_BYTES} bytes; refusing to start sign-in"
        )
    })?;
    Ok(Zeroizing::new(seed))
}

/// Creates a new seed at `path` from the OS CSPRNG, mode 0600, and its directory (mode 0700) if
/// there is none. Refuses if anything is already at `path`.
pub fn init_sign_in_seed(path: &Path) -> Result<(), String> {
    let shown = path.display();
    if !path.is_absolute() {
        return Err(format!(
            "the sign-in seed path must be absolute, got {shown}"
        ));
    }
    if let Some(dir) = path.parent() {
        std::fs::DirBuilder::new()
            .recursive(true)
            .mode(0o700)
            .create(dir)
            .map_err(|e| format!("cannot create {}: {e}", dir.display()))?;
    }
    let mut seed = Zeroizing::new([0u8; OPRF_SEED_BYTES]);
    getrandom::fill(seed.as_mut()).map_err(|e| format!("the OS CSPRNG failed: {e}"))?;
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(path)
        .map_err(|e| match e.kind() {
            std::io::ErrorKind::AlreadyExists => format!(
                "{shown} already exists; refusing to replace a sign-in seed (a new one locks out \
                 every post-quantum account)"
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
