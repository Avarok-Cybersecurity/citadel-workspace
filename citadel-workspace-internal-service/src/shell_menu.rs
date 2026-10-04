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
            Self::Quit => "quit",
        }
    }

    pub fn from_id(id: &str) -> Option<Self> {
        [
            Self::OpenWorkspace,
            Self::CreateWorkspace,
            Self::ToggleLogin,
            Self::ShowLog,
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
/// allowlist is `*`, or not https) there is no site to open, so those two items are left out
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
mod tests {
    use super::*;

    fn titles(menu: &[Entry]) -> Vec<&'static str> {
        menu.iter()
            .map(|e| match e {
                Entry::Action { title, .. } => *title,
                Entry::Separator => "-",
            })
            .collect()
    }

    #[test]
    fn the_menu_is_the_mac_menu_bars_item_for_item() {
        assert_eq!(
            titles(&entries(Some("https://work.avarok.net"), false)),
            [
                "Open Citadel Workspaces",
                "Create a Workspace\u{2026}",
                "-",
                "Start at Login",
                "Show Log",
                "-",
                "Quit Citadel Agent"
            ]
        );
    }

    #[test]
    fn the_titles_match_the_mac_source() {
        // Tray.swift is the other half of "parity": a title edited on one side only fails here.
        let swift = include_str!("../../apps/macos-agent/Tray.swift");
        for entry in entries(Some("https://work.avarok.net"), false) {
            if let Entry::Action { title, .. } = entry {
                assert!(
                    swift.contains(&format!("\"{title}\"")),
                    "{title} is not in Tray.swift"
                );
            }
        }
    }

    #[test]
    fn without_a_site_the_menu_does_not_offer_to_open_it() {
        assert_eq!(
            titles(&entries(None, true)),
            ["Start at Login", "Show Log", "-", "Quit Citadel Agent"]
        );
    }

    #[test]
    fn the_login_item_carries_the_current_state() {
        for on in [true, false] {
            let checked = entries(None, on).into_iter().find_map(|e| match e {
                Entry::Action {
                    action: MenuAction::ToggleLogin,
                    checked,
                    ..
                } => checked,
                _ => None,
            });
            assert_eq!(checked, Some(on));
        }
    }

    #[test]
    fn every_action_survives_the_trip_through_its_id() {
        for entry in entries(Some("https://work.avarok.net"), false) {
            if let Entry::Action { action, .. } = entry {
                assert_eq!(MenuAction::from_id(action.id()), Some(action));
            }
        }
        assert_eq!(MenuAction::from_id("nothing"), None);
    }

    #[test]
    fn the_site_is_the_first_https_origin() {
        let found = workspace_origin(
            "http://localhost:5291, https://work.avarok.net:8443,https://b.example",
        );
        assert_eq!(found.as_deref(), Some("https://work.avarok.net:8443"));
    }

    #[test]
    fn a_wildcard_plain_or_malformed_origin_names_no_site() {
        for spec in [
            "*",
            "http://localhost:5291",
            "https://",
            "https://a b",
            "https://host:99999",
            "https://evil.example/path",
            "",
        ] {
            assert_eq!(workspace_origin(spec), None, "{spec}");
        }
    }

    #[test]
    fn the_create_page_is_under_the_site() {
        assert_eq!(
            create_url("https://work.avarok.net"),
            "https://work.avarok.net/create"
        );
    }

    #[test]
    fn the_log_lives_under_local_app_data() {
        let path = log_file(Some(PathBuf::from("/data"))).unwrap();
        assert_eq!(
            path,
            PathBuf::from("/data")
                .join("Citadel Agent")
                .join("agent.log")
        );
        assert!(log_file(None).is_err());
    }

    #[test]
    fn only_a_log_past_the_limit_starts_over() {
        assert!(!starts_over(None));
        assert!(!starts_over(Some(LOG_LIMIT_BYTES)));
        assert!(starts_over(Some(LOG_LIMIT_BYTES + 1)));
    }

    #[test]
    fn a_taken_port_says_an_agent_is_already_running() {
        let taken = std::io::Error::from(ErrorKind::AddrInUse);
        let message = failure_message(&taken, Some(Path::new("agent.log")));
        assert!(message.contains("already running"), "{message}");
        assert!(!message.contains("agent.log"));
    }

    #[test]
    fn any_other_failure_is_reported_with_where_the_log_is() {
        let other = std::io::Error::other("the origin list is wrong");
        let message = failure_message(&other, Some(Path::new("C:/x/agent.log")));
        assert!(message.contains("the origin list is wrong") && message.contains("agent.log"));
        assert_eq!(failure_message(&other, None), "the origin list is wrong");
    }
}
