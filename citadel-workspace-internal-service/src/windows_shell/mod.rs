//! The Windows shell around the agent: no console window, a notification-area icon, and a log
//! file for the output a console would have shown. The Mac's equivalent is apps/macos-agent;
//! `shell_menu` holds the part the two share.

mod login_item;
mod native;
mod streams;
mod tray;

use crate::shell_menu;
use std::sync::OnceLock;
use streams::Output;

static OUTPUT: OnceLock<Output> = OnceLock::new();

fn log_path() -> Result<std::path::PathBuf, String> {
    shell_menu::log_file(dirs2::data_local_dir())
}

/// First thing in `main`, before anything prints. Cannot return an error to anyone: with no
/// console there is nobody to read it, so it is shown in a dialog and the agent stops.
pub fn init() {
    let routed = log_path().and_then(|log| streams::route(&log));
    match routed {
        Ok(output) => {
            let _ = OUTPUT.set(output);
        }
        Err(why) => {
            native::alert("Citadel Agent cannot start", &why);
            std::process::exit(1);
        }
    }
}

/// Reports a failure that ends the agent. It always goes to the error stream (which is the log
/// when there is no terminal); a dialog is added only when nobody would otherwise see it.
pub fn report_fatal(error: &(dyn std::error::Error + 'static)) {
    let log = match OUTPUT.get() {
        Some(Output::LogFile(path)) => Some(path.as_path()),
        _ => None,
    };
    eprintln!("{error}");
    if log.is_some() {
        native::alert(
            "Citadel Agent stopped",
            &shell_menu::failure_message(error, log),
        );
    }
}

/// Adds the notification-area icon. `allowed_origins` is the origin allowlist the agent runs with.
pub fn start_tray(allowed_origins: &str) {
    let log = match log_path() {
        Ok(log) => log,
        Err(why) => {
            citadel_logging::error!(target: "citadel", "tray: {why}");
            return;
        }
    };
    tray::spawn(tray::Config {
        workspace: shell_menu::workspace_origin(allowed_origins),
        log,
    });
}
