//! The notification-area icon and its menu.
//!
//! A tray icon needs a Win32 message loop on the thread that created it, and the agent's own
//! threads belong to the async runtime, so the icon gets a thread of its own that does nothing
//! else. The menu is `shell_menu::entries`; this draws it and carries out what is chosen.

use super::{login_item, native};
use crate::shell_menu::{self, Entry, MenuAction};
use std::path::PathBuf;
use tray_icon::menu::{CheckMenuItem, Menu, MenuEvent, MenuItem, PredefinedMenuItem};
use tray_icon::{Icon, TrayIcon, TrayIconBuilder};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    DispatchMessageW, GetMessageW, TranslateMessage, MSG,
};

/// The brand's colour mark: a notification area is light on some machines and dark on others, so
/// the full-colour icon, not a monochrome one, is the one that reads on both.
const ICON_PNG: &[u8] = include_bytes!("../../../assets/brand/tray/tray-color-32.png");

pub struct Config {
    /// The site this agent serves; `None` leaves the "open it" items out.
    pub workspace: Option<String>,
    pub log: PathBuf,
}

fn icon() -> Result<Icon, String> {
    let mut reader = png::Decoder::new(std::io::Cursor::new(ICON_PNG))
        .read_info()
        .map_err(|e| format!("the tray icon does not decode: {e}"))?;
    let mut rgba = vec![
        0;
        reader
            .output_buffer_size()
            .ok_or("the tray icon is too large")?
    ];
    let frame = reader
        .next_frame(&mut rgba)
        .map_err(|e| format!("the tray icon does not decode: {e}"))?;
    if frame.color_type != png::ColorType::Rgba || frame.bit_depth != png::BitDepth::Eight {
        return Err("the tray icon is not 8-bit RGBA".into());
    }
    rgba.truncate(frame.buffer_size());
    Icon::from_rgba(rgba, frame.width, frame.height)
        .map_err(|e| format!("the tray icon is unusable: {e}"))
}

/// Draws the entries; returns the check-mark item, which the toggle keeps in step.
fn build_menu(
    workspace: Option<&str>,
    at_login: bool,
) -> Result<(Menu, Option<CheckMenuItem>), String> {
    let menu = Menu::new();
    let mut login = None;
    for entry in shell_menu::entries(workspace, at_login) {
        let added = match entry {
            Entry::Separator => menu.append(&PredefinedMenuItem::separator()),
            Entry::Action {
                action,
                title,
                checked: Some(on),
            } => {
                let item = CheckMenuItem::with_id(action.id(), title, true, on, None);
                let added = menu.append(&item);
                login = Some(item);
                added
            }
            Entry::Action {
                action,
                title,
                checked: None,
            } => menu.append(&MenuItem::with_id(action.id(), title, true, None)),
        };
        added.map_err(|e| format!("could not build the tray menu: {e}"))?;
    }
    Ok((menu, login))
}

fn perform(
    action: MenuAction,
    config: &Config,
    login: Option<&CheckMenuItem>,
    tray: &mut Option<TrayIcon>,
) {
    let opened = match action {
        MenuAction::OpenWorkspace => config.workspace.as_deref().map(native::open),
        MenuAction::CreateWorkspace => config
            .workspace
            .as_deref()
            .map(|o| native::open(&shell_menu::create_url(o))),
        MenuAction::ShowLog => Some(native::open(&config.log.to_string_lossy())),
        MenuAction::ToggleLogin => {
            toggle_login(login);
            None
        }
        MenuAction::Quit => {
            citadel_logging::info!(target: "citadel", "quit from the tray menu");
            // Dropped first: a process that exits with its icon registered leaves it in the
            // notification area until the mouse passes over it.
            tray.take();
            std::process::exit(0);
        }
    };
    if let Some(Err(why)) = opened {
        citadel_logging::error!(target: "citadel", "tray: {why}");
    }
}

fn toggle_login(login: Option<&CheckMenuItem>) {
    let result = login_item::is_enabled().and_then(|on| login_item::set_enabled(!on));
    if let Err(why) = &result {
        citadel_logging::error!(target: "citadel", "tray: start at login: {why}");
    }
    // The widget flips its own mark when clicked; show what the registry says is true.
    if let (Some(item), Ok(on)) = (login, login_item::is_enabled()) {
        item.set_checked(on);
    }
}

fn run(config: &Config) -> Result<(), String> {
    let at_login = login_item::is_enabled()?;
    let (menu, login) = build_menu(config.workspace.as_deref(), at_login)?;
    let tray = TrayIconBuilder::new()
        .with_menu(Box::new(menu))
        .with_icon(icon()?)
        .with_tooltip("Citadel Agent")
        .build()
        .map_err(|e| format!("could not add the notification-area icon: {e}"))?;
    let mut tray = Some(tray);
    let events = MenuEvent::receiver();
    // SAFETY: MSG is plain data for which all-zero is a valid empty value.
    let mut message: MSG = unsafe { std::mem::zeroed() };
    // SAFETY: `message` is a valid out-pointer; a null window handle takes this thread's messages.
    // GetMessageW returns 0 on WM_QUIT and -1 on error: either ends the loop.
    while unsafe { GetMessageW(&mut message, std::ptr::null_mut(), 0, 0) } > 0 {
        // SAFETY: `message` was just filled in by GetMessageW.
        unsafe {
            TranslateMessage(&message);
            DispatchMessageW(&message);
        }
        while let Ok(event) = events.try_recv() {
            match MenuAction::from_id(&event.id.0) {
                Some(action) => perform(action, config, login.as_ref(), &mut tray),
                None => {
                    citadel_logging::error!(target: "citadel", "tray: unknown menu item {:?}", event.id)
                }
            }
        }
    }
    Err("the tray's message loop ended".into())
}

/// Starts the icon on its own thread. A failure is logged and leaves the agent running: the
/// agent is the product, and losing the icon (no notification area yet, say) must not take it down.
pub fn spawn(config: Config) {
    let started = std::thread::Builder::new()
        .name("tray".into())
        .spawn(move || {
            if let Err(why) = run(&config) {
                citadel_logging::error!(target: "citadel", "tray: {why}");
            }
        });
    if let Err(why) = started {
        citadel_logging::error!(target: "citadel", "tray: could not start its thread: {why}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_shipped_icon_decodes() {
        assert!(icon().is_ok());
    }
}
