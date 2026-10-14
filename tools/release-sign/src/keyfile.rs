//! The private key file, for any ML-DSA-65 key Avarok holds offline (the release key here, the
//! support key in tools/telemetry-read): the 32-byte seed as 64 lowercase hex characters and a
//! newline. Created with mode 0600, never over an existing file; whitespace around it is ignored
//! when read. The seed is wiped when dropped and is never printed.

use citadel_release_signature::SEED_LEN;
use std::io::Write;
use std::path::Path;
use zeroize::{Zeroize, Zeroizing};

/// A fresh seed from the OS, written to `path` (new, mode 0600).
pub fn create_seed_file(path: &Path) -> Result<Zeroizing<[u8; SEED_LEN]>, String> {
    let mut seed = Zeroizing::new([0u8; SEED_LEN]);
    getrandom::fill(seed.as_mut()).map_err(|e| format!("no OS randomness: {e}"))?;
    let mut encoded = Zeroizing::new(hex::encode(seed.as_ref()));
    encoded.push('\n');
    let mut file = create_private(path)?;
    file.write_all(encoded.as_bytes())
        .and_then(|()| file.sync_all())
        .map_err(|e| format!("{}: {e}", path.display()))?;
    Ok(seed)
}

/// The seed in `path`.
pub fn read_seed_file(path: &Path) -> Result<Zeroizing<[u8; SEED_LEN]>, String> {
    let text = Zeroizing::new(
        std::fs::read_to_string(path).map_err(|e| format!("{}: {e}", path.display()))?,
    );
    let trimmed = text.trim();
    if trimmed.len() != SEED_LEN * 2 {
        return Err(format!(
            "{}: the private key is {} hex characters, not the {} of a {SEED_LEN}-byte seed",
            path.display(),
            trimmed.len(),
            SEED_LEN * 2
        ));
    }
    let mut seed = Zeroizing::new([0u8; SEED_LEN]);
    // The decoder's error names the offending character, which is part of the key: not shown.
    if hex::decode_to_slice(trimmed, seed.as_mut()).is_err() {
        seed.zeroize();
        return Err(format!("{}: the private key is not hex", path.display()));
    }
    Ok(seed)
}

fn create_private(path: &Path) -> Result<std::fs::File, String> {
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options
        .open(path)
        .map_err(|e| format!("{} (keygen never overwrites a key): {e}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_created_seed_reads_back_from_a_private_file_that_is_never_overwritten() {
        let dir = tempfile::tempdir().expect("a temp dir");
        let path = dir.path().join("key");
        let seed = create_seed_file(&path).expect("created");
        assert_eq!(*read_seed_file(&path).expect("read"), *seed);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(&path).expect("stat").permissions().mode();
            assert_eq!(mode & 0o777, 0o600);
        }
        assert!(create_seed_file(&path).is_err());
        assert_eq!(*read_seed_file(&path).expect("unchanged"), *seed);
    }

    #[test]
    fn a_file_that_is_not_a_seed_is_refused_without_echoing_it() {
        let dir = tempfile::tempdir().expect("a temp dir");
        let path = dir.path().join("key");
        std::fs::write(&path, "zz".repeat(SEED_LEN)).expect("written");
        let refusal = read_seed_file(&path).expect_err("not hex");
        assert!(
            refusal.ends_with(": the private key is not hex"),
            "{refusal}"
        );
        std::fs::write(&path, "ab").expect("written");
        assert!(read_seed_file(&path).is_err());
    }
}
