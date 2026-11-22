//! Removing the refused directory: to the Trash or Recycle Bin wherever there is one, so a
//! mistaken click can be undone, and permanently only where there is none.

use std::path::Path;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Disposal {
    /// Moved to the Trash (Recycle Bin on Windows): restorable.
    Trash,
    /// Deleted: this system has no Trash for that folder.
    Delete,
}

/// The port starting fresh disposes through.
pub trait Disposer {
    /// What `dispose` will do to `dir`, decided before the person is asked so the dialog says it.
    fn disposal_for(&self, dir: &Path) -> Disposal;
    /// Does exactly `disposal`. A failed move to the Trash is an error, never a quiet deletion:
    /// the person agreed to a restorable move.
    fn dispose(&self, dir: &Path, disposal: Disposal) -> std::io::Result<()>;
}

/// The operating system's Trash, through the `trash` crate (NSFileManager on macOS, the shell's
/// file operation on Windows, the freedesktop.org Trash specification on Linux).
pub struct SystemDisposer;

impl Disposer for SystemDisposer {
    fn disposal_for(&self, dir: &Path) -> Disposal {
        if has_trash_for(dir) {
            Disposal::Trash
        } else {
            Disposal::Delete
        }
    }

    fn dispose(&self, dir: &Path, disposal: Disposal) -> std::io::Result<()> {
        match disposal {
            Disposal::Trash => trash::delete(dir).map_err(|e| {
                std::io::Error::other(format!(
                    "Citadel could not move {} to the Trash, and did not delete it: {e}",
                    dir.display()
                ))
            }),
            Disposal::Delete => std::fs::remove_dir_all(dir),
        }
    }
}

#[cfg(any(target_os = "macos", windows))]
fn has_trash_for(_dir: &Path) -> bool {
    true
}

/// The freedesktop.org home trash ($XDG_DATA_HOME/Trash) takes only what is on its own
/// filesystem; a data directory elsewhere (another mount) has none this can rely on.
#[cfg(all(unix, not(target_os = "macos")))]
fn has_trash_for(dir: &Path) -> bool {
    use std::os::unix::fs::MetadataExt;
    let data_home = std::env::var_os("XDG_DATA_HOME")
        .filter(|v| !v.is_empty())
        .map(std::path::PathBuf::from)
        .or_else(|| dirs2::home_dir().map(|h| h.join(".local/share")));
    let Some(data_home) = data_home else {
        return false;
    };
    // The nearest existing ancestor of the trash: the Trash itself is created on first use.
    let Some(existing) = data_home.ancestors().find(|p| p.exists()) else {
        return false;
    };
    match (std::fs::metadata(existing), std::fs::metadata(dir)) {
        (Ok(trash), Ok(target)) => trash.dev() == target.dev(),
        _ => false,
    }
}
