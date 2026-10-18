//! The workspace's sign-in settings on a native server: one JSON file, `{"require_turnstile_sign_in":
//! bool}`, the same shape the Durable Object keeps under `control:sign-in-settings`.
//!
//! Read once at startup (a malformed file stops the server rather than reading as "off") and
//! held in memory, so the admission check every sign-in runs does no I/O; each change is written
//! to a temporary file and renamed over the old one, then held. One server owns the file.
//!
//! No file yet is the one default, and the worker's: off until an admin turns it on.

use crate::kernel::sign_in::{SignInSettingsStore, SignInSettingsUnavailable};
use citadel_workspace_types::sign_in::SignInSettings;
use parking_lot::Mutex;
use std::io::Write;
use std::os::unix::fs::OpenOptionsExt;
use std::path::{Path, PathBuf};

pub struct FileSignInSettings {
    path: PathBuf,
    current: Mutex<SignInSettings>,
}

const OFF: SignInSettings = SignInSettings {
    require_turnstile_sign_in: false,
};

impl FileSignInSettings {
    /// The settings at `path`, which need not exist yet; its directory must.
    pub fn open(path: &Path) -> Result<Self, String> {
        let shown = path.display();
        let current = match std::fs::read(path) {
            Ok(bytes) => serde_json::from_slice(&bytes)
                .map_err(|e| format!("the sign-in settings file {shown} is malformed: {e}"))?,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                let dir = path.parent().filter(|dir| dir.is_dir()).ok_or_else(|| {
                    format!("the sign-in settings file {shown} has no directory to be written in")
                })?;
                log::info!(target: "citadel", "No sign-in settings in {}: the human check is off until an admin turns it on", dir.display());
                OFF
            }
            Err(e) => return Err(format!("the sign-in settings file {shown}: {e}")),
        };
        Ok(Self {
            path: path.to_path_buf(),
            current: Mutex::new(current),
        })
    }

    fn write(&self, settings: &SignInSettings) -> std::io::Result<()> {
        let json = serde_json::to_vec(settings).map_err(std::io::Error::other)?;
        let staged = self.path.with_extension("tmp");
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .mode(0o600)
            .open(&staged)?;
        file.write_all(&json)?;
        file.sync_all()?;
        std::fs::rename(&staged, &self.path)
    }
}

#[async_trait::async_trait]
impl SignInSettingsStore for FileSignInSettings {
    async fn load(&self) -> Result<SignInSettings, SignInSettingsUnavailable> {
        Ok(*self.current.lock())
    }

    async fn store(&self, settings: SignInSettings) -> Result<(), SignInSettingsUnavailable> {
        let mut current = self.current.lock();
        self.write(&settings).map_err(|e| {
            log::error!(target: "citadel", "The sign-in settings could not be written to {}: {e}", self.path.display());
            SignInSettingsUnavailable("the server could not save the sign-in settings".to_string())
        })?;
        *current = settings;
        Ok(())
    }
}
