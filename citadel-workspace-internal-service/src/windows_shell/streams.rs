//! Where the agent's output goes now that it has no console of its own.
//!
//! The release build is a Windows-subsystem program, so Windows gives it no console window. That
//! leaves the standard output and error handles empty unless whoever started it supplied them,
//! and the three ways it is started need three answers:
//!   * redirected (`agent.exe --version > out.txt`, a pipe from a script or CI): the handles are
//!     already valid and are left alone;
//!   * from a terminal: attach to that terminal, so `--version` and `--help` print where the
//!     person typed them;
//!   * from the Start menu, the login entry or the installer: no terminal exists, so output goes
//!     to the log file "Show Log" opens.

use std::fs::OpenOptions;
use std::os::windows::io::IntoRawHandle;
use std::path::{Path, PathBuf};
use windows_sys::Win32::Foundation::{HANDLE, INVALID_HANDLE_VALUE};
use windows_sys::Win32::System::Console::{
    AttachConsole, GetStdHandle, SetStdHandle, ATTACH_PARENT_PROCESS, STD_ERROR_HANDLE, STD_HANDLE,
    STD_OUTPUT_HANDLE,
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Output {
    /// The starter gave this process its output; nothing was changed.
    Inherited,
    /// Attached to the terminal that started it.
    Terminal,
    /// No terminal and nothing redirected: output is appended to this file.
    LogFile(PathBuf),
}

fn has_handle(which: STD_HANDLE) -> bool {
    // SAFETY: GetStdHandle has no preconditions.
    let handle = unsafe { GetStdHandle(which) };
    !handle.is_null() && handle != INVALID_HANDLE_VALUE
}

fn set_handle(which: STD_HANDLE, handle: HANDLE) -> Result<(), String> {
    // SAFETY: `handle` is a live handle this process owns and keeps open for its whole life.
    if unsafe { SetStdHandle(which, handle) } == 0 {
        return Err(format!(
            "could not set a standard handle: {}",
            std::io::Error::last_os_error()
        ));
    }
    Ok(())
}

fn attach_to_terminal() -> Result<bool, String> {
    // SAFETY: no preconditions; fails (returns 0) when the parent has no console.
    if unsafe { AttachConsole(ATTACH_PARENT_PROCESS) } == 0 {
        return Ok(false);
    }
    // Attaching does not give the process handles; open the console's own output.
    let console = OpenOptions::new()
        .write(true)
        .open("CONOUT$")
        .map_err(|e| format!("could not open the terminal's output: {e}"))?;
    let handle = console.into_raw_handle();
    for which in [STD_OUTPUT_HANDLE, STD_ERROR_HANDLE] {
        if !has_handle(which) {
            set_handle(which, handle)?;
        }
    }
    Ok(true)
}

fn open_log(path: &Path) -> Result<std::fs::File, String> {
    let io = |what: &str, e: std::io::Error| format!("could not {what} {}: {e}", path.display());
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| io("create", e))?;
    }
    let len = std::fs::metadata(path).ok().map(|m| m.len());
    let mut options = OpenOptions::new();
    if crate::shell_menu::starts_over(len) {
        options.write(true).create(true).truncate(true);
    } else {
        options.append(true).create(true);
    }
    options.open(path).map_err(|e| io("open", e))
}

/// Makes the standard streams usable. Call before anything prints.
pub fn route(log: &Path) -> Result<Output, String> {
    if has_handle(STD_OUTPUT_HANDLE) && has_handle(STD_ERROR_HANDLE) {
        return Ok(Output::Inherited);
    }
    if attach_to_terminal()? {
        return Ok(Output::Terminal);
    }
    let handle = open_log(log)?.into_raw_handle();
    for which in [STD_OUTPUT_HANDLE, STD_ERROR_HANDLE] {
        if !has_handle(which) {
            set_handle(which, handle)?;
        }
    }
    Ok(Output::LogFile(log.to_path_buf()))
}
