//! "Start at Login": the per-user Run entry the installer writes (packaging/windows).
//!
//! The installer owns the entry's creation and removal at install and uninstall; this is the user
//! turning it off and on in between. Turning it on writes this process's own command line, so the
//! flags that start the agent today are the ones that start it at the next login.

use super::native::wide;
use std::ptr::null_mut;
use windows_sys::Win32::Foundation::{ERROR_FILE_NOT_FOUND, ERROR_SUCCESS};
use windows_sys::Win32::System::Console::GetCommandLineW;
use windows_sys::Win32::System::Registry::{
    RegCloseKey, RegCreateKeyExW, RegDeleteValueW, RegQueryValueExW, RegSetValueExW, HKEY,
    HKEY_CURRENT_USER, KEY_QUERY_VALUE, KEY_SET_VALUE, REG_OPTION_NON_VOLATILE, REG_SZ,
};

pub const RUN_KEY: &str = "Software\\Microsoft\\Windows\\CurrentVersion\\Run";
/// The name the installer gives its value (packaging/windows/citadel-agent.wxs).
pub const VALUE_NAME: &str = "Citadel Agent";

struct Key(HKEY);

impl Key {
    fn open(path: &str, access: u32) -> Result<Self, String> {
        let mut key: HKEY = null_mut();
        let path = wide(path);
        // SAFETY: `path` is NUL-terminated; `key` is a valid out-pointer; the class and
        // security-attribute pointers are documented as optional.
        let status = unsafe {
            RegCreateKeyExW(
                HKEY_CURRENT_USER,
                path.as_ptr(),
                0,
                null_mut(),
                REG_OPTION_NON_VOLATILE,
                access,
                null_mut(),
                &mut key,
                null_mut(),
            )
        };
        check(status, "open the registry key").map(|()| Self(key))
    }
}

impl Drop for Key {
    fn drop(&mut self) {
        // SAFETY: the handle came from RegCreateKeyExW and is closed once, here.
        unsafe { RegCloseKey(self.0) };
    }
}

fn check(status: u32, doing: &str) -> Result<(), String> {
    if status == ERROR_SUCCESS {
        Ok(())
    } else {
        Err(format!("could not {doing} (Windows error {status})"))
    }
}

pub fn is_enabled_in(key_path: &str, name: &str) -> Result<bool, String> {
    let key = Key::open(key_path, KEY_QUERY_VALUE)?;
    let name = wide(name);
    // SAFETY: `name` is NUL-terminated; a null data pointer asks only whether the value exists.
    let status = unsafe {
        RegQueryValueExW(
            key.0,
            name.as_ptr(),
            null_mut(),
            null_mut(),
            null_mut(),
            null_mut(),
        )
    };
    match status {
        ERROR_SUCCESS => Ok(true),
        ERROR_FILE_NOT_FOUND => Ok(false),
        other => Err(format!(
            "could not read the login entry (Windows error {other})"
        )),
    }
}

pub fn set_in(key_path: &str, name: &str, command: Option<&[u16]>) -> Result<(), String> {
    let key = Key::open(key_path, KEY_SET_VALUE)?;
    let name = wide(name);
    match command {
        Some(command) => {
            let bytes = u32::try_from(std::mem::size_of_val(command))
                .map_err(|_| "the command line is too long".to_string())?;
            // SAFETY: `command` is NUL-terminated UTF-16 of `bytes` bytes, as REG_SZ requires.
            let status = unsafe {
                RegSetValueExW(
                    key.0,
                    name.as_ptr(),
                    0,
                    REG_SZ,
                    command.as_ptr().cast(),
                    bytes,
                )
            };
            check(status, "write the login entry")
        }
        None => {
            // SAFETY: `name` is NUL-terminated.
            let status = unsafe { RegDeleteValueW(key.0, name.as_ptr()) };
            if status == ERROR_FILE_NOT_FOUND {
                return Ok(());
            }
            check(status, "remove the login entry")
        }
    }
}

pub fn is_enabled() -> Result<bool, String> {
    is_enabled_in(RUN_KEY, VALUE_NAME)
}

/// Turns the login entry on (running this process's command line) or off.
pub fn set_enabled(enabled: bool) -> Result<(), String> {
    if !enabled {
        return set_in(RUN_KEY, VALUE_NAME, None);
    }
    // SAFETY: GetCommandLineW returns this process's NUL-terminated command line, valid for the
    // life of the process.
    let command = unsafe {
        let start = GetCommandLineW();
        let mut len = 0;
        while *start.add(len) != 0 {
            len += 1;
        }
        std::slice::from_raw_parts(start, len + 1)
    };
    set_in(RUN_KEY, VALUE_NAME, Some(command))
}

#[cfg(test)]
mod tests {
    use super::*;

    // A key of the test's own, so the real login entry is never touched.
    const SCRATCH: &str = "Software\\Avarok\\Citadel Agent Tests\\login-item";

    #[test]
    fn an_entry_is_written_read_and_removed() {
        let name = "round-trip";
        set_in(SCRATCH, name, None).unwrap();
        assert!(!is_enabled_in(SCRATCH, name).unwrap());
        set_in(
            SCRATCH,
            name,
            Some(&wide("\"C:\\a.exe\" --bind 127.0.0.1:1")),
        )
        .unwrap();
        assert!(is_enabled_in(SCRATCH, name).unwrap());
        set_in(SCRATCH, name, None).unwrap();
        assert!(!is_enabled_in(SCRATCH, name).unwrap());
    }

    #[test]
    fn removing_an_entry_that_is_not_there_is_not_an_error() {
        assert!(set_in(SCRATCH, "never-written", None).is_ok());
    }
}
