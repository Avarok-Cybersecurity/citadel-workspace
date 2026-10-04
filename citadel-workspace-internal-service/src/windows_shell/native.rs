//! The few Win32 calls the shell needs, with their error handling.

use std::ffi::OsStr;
use std::os::windows::ffi::OsStrExt;
use std::ptr::{null, null_mut};
use windows_sys::Win32::UI::Shell::ShellExecuteW;
use windows_sys::Win32::UI::WindowsAndMessaging::{
    MessageBoxW, MB_ICONERROR, MB_OK, SW_SHOWNORMAL,
};

/// UTF-16 with the terminating NUL Win32 expects.
pub fn wide(text: impl AsRef<OsStr>) -> Vec<u16> {
    text.as_ref().encode_wide().chain(Some(0)).collect()
}

/// Opens a URL or a file with whatever the user has chosen for it, as double-clicking would.
pub fn open(target: &str) -> Result<(), String> {
    let verb = wide("open");
    let target_wide = wide(target);
    // SAFETY: both strings are NUL-terminated and outlive the call; the remaining pointers are
    // documented as optional.
    let result = unsafe {
        ShellExecuteW(
            null_mut(),
            verb.as_ptr(),
            target_wide.as_ptr(),
            null(),
            null(),
            SW_SHOWNORMAL,
        )
    };
    // ShellExecuteW reports success as a value above 32, and failure as an error code.
    if result as usize > 32 {
        Ok(())
    } else {
        Err(format!(
            "Windows could not open {target} (code {})",
            result as usize
        ))
    }
}

/// A message the user must dismiss. Blocks, so only for a failure that ends the agent.
pub fn alert(title: &str, text: &str) {
    let (title, text) = (wide(title), wide(text));
    // SAFETY: both strings are NUL-terminated and outlive the call.
    unsafe {
        MessageBoxW(
            null_mut(),
            text.as_ptr(),
            title.as_ptr(),
            MB_OK | MB_ICONERROR,
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wide_strings_are_nul_terminated() {
        assert_eq!(wide("ab"), [97, 98, 0]);
    }

    #[test]
    fn a_target_windows_cannot_open_is_an_error() {
        assert!(open("C:\\this\\does\\not\\exist.nope").is_err());
    }
}
