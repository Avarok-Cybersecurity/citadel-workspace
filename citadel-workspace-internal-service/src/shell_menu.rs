//! What the Windows tray offers, and what the agent says when it cannot start.
//!
//! The model is plain data so it is tested wherever the suite runs; only `windows_shell`, which
//! draws it with Win32, is Windows-only. It is the Mac menu bar's right-click menu
//! (apps/macos-agent/Tray.swift, `menuNeedsUpdate`), item for item. The one omission is
//! "Restart Agent", which the Mac shows only when its separate launcher process gave up on a
//! crashing agent; here the agent is the process that owns the icon, so there is nothing to restart.
#![cfg_attr(not(windows), allow(dead_code))]

use std::error::Error;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};

/// Beyond this the log starts over at launch, as the Mac launcher's does: a crash loop left alone
/// must not fill a disk.
pub const LOG_LIMIT_BYTES: u64 = 10 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MenuAction {
    OpenWorkspace,
    CreateWorkspace,
    ToggleLogin,
    ShowLog,
    About,
    CheckUpdates,
    Quit,
}

impl MenuAction {
    /// The id the menu widget carries; the widget hands it back when the item is chosen.
    pub fn id(self) -> &'static str {
        match self {
            Self::OpenWorkspace => "open-workspace",
            Self::CreateWorkspace => "create-workspace",
            Self::ToggleLogin => "toggle-login",
            Self::ShowLog => "show-log",
            Self::About => "about",
            Self::CheckUpdates => "check-updates",
            Self::Quit => "quit",
        }
    }

    pub fn from_id(id: &str) -> Option<Self> {
        [
            Self::OpenWorkspace,
            Self::CreateWorkspace,
            Self::ToggleLogin,
            Self::ShowLog,
            Self::About,
            Self::CheckUpdates,
            Self::Quit,
        ]
        .into_iter()
        .find(|action| action.id() == id)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Entry {
    Action {
        action: MenuAction,
        title: &'static str,
        /// `Some` for an item with a check mark.
        checked: Option<bool>,
    },
    Separator,
}

/// The menu, top to bottom. `workspace` is the site the agent serves; without one (the origin
/// allowlist is `*`, or not https) there is no site to open, so the items that open it are left out
/// rather than pointing nowhere.
pub fn entries(workspace: Option<&str>, start_at_login: bool) -> Vec<Entry> {
    let action = |action, title| Entry::Action {
        action,
        title,
        checked: None,
    };
    let mut menu = Vec::new();
    if workspace.is_some() {
        menu.push(action(MenuAction::OpenWorkspace, "Open Citadel Workspaces"));
        menu.push(action(
            MenuAction::CreateWorkspace,
            "Create a Workspace\u{2026}",
        ));
        menu.push(Entry::Separator);
    }
    menu.push(Entry::Action {
        action: MenuAction::ToggleLogin,
        title: "Start at Login",
        checked: Some(start_at_login),
    });
    menu.push(action(MenuAction::ShowLog, "Show Log"));
    menu.push(Entry::Separator);
    if workspace.is_some() {
        menu.push(action(MenuAction::About, "About Citadel Agent"));
        menu.push(action(
            MenuAction::CheckUpdates,
            "Check for Updates\u{2026}",
        ));
        menu.push(Entry::Separator);
    }
    menu.push(action(MenuAction::Quit, "Quit Citadel Agent"));
    menu
}

/// The site to open: the first `https://host[:port]` of the allowlist the agent was started
/// with. The packaged launchers pass exactly one (apps/macos-agent/Info.plist); a list from a
/// developer's shell takes its first usable entry. `*` and plain http name no site.
pub fn workspace_origin(allowed_origins: &str) -> Option<String> {
    allowed_origins
        .split(',')
        .map(str::trim)
        .find(|origin| is_https_origin(origin))
        .map(str::to_owned)
}

fn is_https_origin(origin: &str) -> bool {
    let Some(authority) = origin.strip_prefix("https://") else {
        return false;
    };
    let (host, port) = authority.split_once(':').unwrap_or((authority, "1"));
    !host.is_empty()
        && host
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-')
        && port.parse::<u16>().is_ok()
}

pub fn create_url(origin: &str) -> String {
    format!("{origin}/create")
}

/// The workspace's page about this agent, at one of its sections (`about`, `updates`): the Mac
/// menu bar opens the same addresses.
pub fn agent_page_url(origin: &str, section: &str) -> String {
    format!("{origin}/agent#{section}")
}

/// `<local app data>\Citadel Agent\agent.log`: where "Show Log" opens, and where output goes when
/// the agent has no console to write to.
pub fn log_file(local_app_data: Option<PathBuf>) -> Result<PathBuf, String> {
    let dir = local_app_data.ok_or(
        "Windows did not say where this account's local application data is, so there is \
         nowhere to keep the log.",
    )?;
    Ok(dir.join("Citadel Agent").join("agent.log"))
}

/// Whether an existing log of this size is replaced rather than appended to.
pub fn starts_over(existing_len: Option<u64>) -> bool {
    existing_len.is_some_and(|len| len > LOG_LIMIT_BYTES)
}

/// What a person who started the agent without a terminal is told when it stops. A second copy
/// is the common case (the login entry and the Start-menu shortcut both start one), and the
/// useful answer to it is that one is already running.
pub fn failure_message(error: &(dyn Error + 'static), log: Option<&Path>) -> String {
    let mut source: Option<&(dyn Error + 'static)> = Some(error);
    while let Some(err) = source {
        if err
            .downcast_ref::<std::io::Error>()
            .is_some_and(|io| io.kind() == ErrorKind::AddrInUse)
        {
            return "Citadel Agent is already running.\n\nLook for its icon in the notification \
                    area, next to the clock."
                .to_owned();
        }
        source = err.source();
    }
    match log {
        Some(path) => format!("{error}\n\nThe log is at {}", path.display()),
        None => error.to_string(),
    }
}

#[cfg(test)]
mod tests;
