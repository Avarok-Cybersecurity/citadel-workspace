//! The signal a separate launcher reads: the agent exits with `START_FRESH_EXIT_CODE` and writes
//! this file, at the path the launcher named in `CITADEL_AGENT_STATUS_FILE`, before exiting.
//!
//! The launcher reacts only when the exit status equals the `exit_code` the file carries, so it
//! keeps no copy of the number, and a file left from an earlier run (or any other exit) is never
//! taken for this one. It also carries the dialog's words (copy.rs), so the Mac shows the same
//! text the other platforms do. Read by apps/macos-agent/StartFresh.swift.

use super::{dialog, Disposal, Offer, START_FRESH_EXIT_CODE};
use std::path::PathBuf;

pub const STATUS_FILE_ENV: &str = "CITADEL_AGENT_STATUS_FILE";

/// Its schema version: a launcher refuses a version it does not know rather than guess.
const VERSION: u32 = 1;
const SIGNAL: &str = "start-fresh";

pub struct StatusFile {
    path: PathBuf,
}

impl StatusFile {
    /// The file the launcher asked for, if any: unset or empty means no launcher is listening.
    pub fn from_env_value(value: Option<&str>) -> Option<Self> {
        value.filter(|v| !v.is_empty()).map(|v| Self {
            path: PathBuf::from(v),
        })
    }

    pub fn contents(offer: &Offer) -> serde_json::Value {
        let words = dialog(offer);
        serde_json::json!({
            "v": VERSION,
            "signal": SIGNAL,
            "exit_code": START_FRESH_EXIT_CODE,
            "data_dir": offer.dir.to_string_lossy(),
            "disposal": match offer.disposal { Disposal::Trash => "trash", Disposal::Delete => "delete" },
            "title": words.title,
            "message": words.message,
            "confirm": words.confirm,
            "cancel": words.cancel,
        })
    }

    pub fn write(&self, offer: &Offer) -> std::io::Result<()> {
        // Staged and renamed into place: the launcher must never read a half-written offer.
        let staged = self.path.with_extension("partial");
        std::fs::write(&staged, serde_json::to_vec(&Self::contents(offer))?)?;
        std::fs::rename(&staged, &self.path)
    }
}
