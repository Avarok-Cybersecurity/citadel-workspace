//! The start-fresh question as a Windows message box (crate::fresh_start): OK and Cancel are
//! relabelled "Start fresh" and "Quit", Cancel is the default, and Esc or closing the box is
//! Cancel, so only a click on "Start fresh" removes anything.

use crate::fresh_start::{dialog, Answer, Offer, Prompt};
use crate::windows_shell::native::wide;
use std::cell::RefCell;
use std::ptr::null_mut;
use windows_sys::Win32::Foundation::{LPARAM, LRESULT, WPARAM};
use windows_sys::Win32::System::Threading::GetCurrentThreadId;
use windows_sys::Win32::UI::WindowsAndMessaging::{
    CallNextHookEx, MessageBoxW, SetDlgItemTextW, SetWindowsHookExW, UnhookWindowsHookEx,
    HCBT_ACTIVATE, HHOOK, IDCANCEL, IDOK, MB_DEFBUTTON2, MB_ICONWARNING, MB_OKCANCEL,
    MB_SETFOREGROUND, WH_CBT,
};

/// Shown only by an agent with no console (`windows_shell::start_fresh_prompt`).
pub struct MessageBoxPrompt;

/// The hook, and the confirm and cancel labels it sets, as NUL-terminated UTF-16.
type Relabel = (HHOOK, Vec<u16>, Vec<u16>);

thread_local! {
    /// For the one box this thread is about to show.
    static RELABEL: RefCell<Option<Relabel>> = const { RefCell::new(None) };
}

/// Sets the button labels when the box is activated, then removes itself.
unsafe extern "system" fn relabel(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code == HCBT_ACTIVATE as i32 {
        if let Some((hook, confirm, cancel)) = RELABEL.with(|r| r.borrow_mut().take()) {
            // SAFETY: for HCBT_ACTIVATE, wparam is the handle of the window being activated, here
            // the message box; the labels are NUL-terminated and live until the calls return.
            unsafe {
                let dialog = wparam as windows_sys::Win32::Foundation::HWND;
                SetDlgItemTextW(dialog, IDOK, confirm.as_ptr());
                SetDlgItemTextW(dialog, IDCANCEL, cancel.as_ptr());
                UnhookWindowsHookEx(hook);
            }
            return 0;
        }
    }
    // SAFETY: passing the hook chain on, as every hook procedure must.
    unsafe { CallNextHookEx(null_mut(), code, wparam, lparam) }
}

impl Prompt for MessageBoxPrompt {
    fn ask(&self, offer: &Offer) -> Option<Answer> {
        let words = dialog(offer);
        let (title, text) = (wide(&words.title), wide(&words.message));
        // SAFETY: a thread-local CBT hook on this thread only; `relabel` removes it.
        let hook =
            unsafe { SetWindowsHookExW(WH_CBT, Some(relabel), null_mut(), GetCurrentThreadId()) };
        if !hook.is_null() {
            RELABEL.with(|r| {
                *r.borrow_mut() = Some((hook, wide(&words.confirm), wide(&words.cancel)))
            });
        }
        // SAFETY: both strings are NUL-terminated and outlive the call.
        let pressed = unsafe {
            MessageBoxW(
                null_mut(),
                text.as_ptr(),
                title.as_ptr(),
                MB_OKCANCEL | MB_DEFBUTTON2 | MB_ICONWARNING | MB_SETFOREGROUND,
            )
        };
        // A box that never showed its labels (no hook) still shows the text, whose question the
        // OK/Cancel pair answers; clear a hook that was never reached.
        if let Some((hook, _, _)) = RELABEL.with(|r| r.borrow_mut().take()) {
            // SAFETY: the hook this call installed and nothing has removed.
            unsafe { UnhookWindowsHookEx(hook) };
        }
        Some(answer_from_message_box(pressed))
    }
}

/// Only the OK button, relabelled "Start fresh", is Start fresh; Cancel, Esc, closing the box and
/// a failure to show it (0) are all Quit.
pub fn answer_from_message_box(pressed: i32) -> Answer {
    if pressed == IDOK {
        Answer::StartFresh
    } else {
        Answer::Quit
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_ok_starts_fresh() {
        assert_eq!(answer_from_message_box(IDOK), Answer::StartFresh);
        for other in [IDCANCEL, 0, 7] {
            assert_eq!(answer_from_message_box(other), Answer::Quit);
        }
    }
}
