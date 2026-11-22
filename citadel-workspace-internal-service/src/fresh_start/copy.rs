//! The words of the start-fresh dialog, in one place for every platform: the Windows and Linux
//! prompts show them from here, and the Mac launcher shows what the status file carries.

use super::{Disposal, Offer};
use std::path::Path;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Dialog {
    pub title: String,
    pub message: String,
    /// The destructive button. Never the default, never what Esc chooses.
    pub confirm: String,
    /// The default button, and what Esc and closing the dialog choose.
    pub cancel: String,
}

#[cfg(target_os = "macos")]
const TRASH: &str = "the Trash";
#[cfg(windows)]
const TRASH: &str = "the Recycle Bin";
#[cfg(all(unix, not(target_os = "macos")))]
const TRASH: &str = "the Trash";

pub fn dialog(offer: &Offer) -> Dialog {
    let how = match offer.disposal {
        Disposal::Trash => {
            format!("The folder is moved to {TRASH}, so you can restore it from there.")
        }
        Disposal::Delete => "This folder cannot go to a Trash on this system, so it is \
                             deleted permanently."
            .to_string(),
    };
    Dialog {
        title: "Citadel can't read your earlier data".to_string(),
        message: format!(
            "Citadel was updated and can't read the data from your earlier version.\n\n\
             Start fresh? This removes your local Citadel data (accounts and messages on this \
             device) and restarts Citadel. You'll sign in or sign up again.\n\n{how}\n\n{}",
            offer.dir.display()
        ),
        confirm: "Start fresh".to_string(),
        cancel: "Quit".to_string(),
    }
}

/// The one line a terminal user runs to do the same by hand, with the agent stopped.
pub fn remove_command(dir: &Path) -> String {
    let dir = dir.display().to_string();
    if cfg!(windows) {
        // PowerShell: a single-quoted string is literal, and a quote inside it is doubled.
        format!(
            "Remove-Item -LiteralPath '{}' -Recurse -Force",
            dir.replace('\'', "''")
        )
    } else {
        // POSIX sh: a single-quoted string is literal; a quote closes, escapes and reopens it.
        format!("rm -rf -- '{}'", dir.replace('\'', "'\\''"))
    }
}
