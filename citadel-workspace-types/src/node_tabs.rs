//! The metadata keys behind a node's tabs and time zone, and what each may hold.
//!
//! A node's pane always opens on its page, and shows its chat exactly when chat is enabled; those
//! two are the node itself and are never stored. What is stored is the ordered list of APP tabs:
//!
//! - `Workspace.metadata["default_app_tabs"]`: what a node shows when it has no list of its own.
//! - `DomainNode.metadata["app_tabs"]`: the node's own list. Absent means "the workspace default";
//!   present, even empty, means exactly this list. A node that never deviated therefore follows
//!   later changes to the default rather than holding a copy of it.
//! - `DomainNode.metadata["time_zone"]`: an IANA name overriding the workspace's `time_zone`.
//!
//! The UI's `lib/node-tabs/tab-keys.ts` names the same keys and limit, and is tested against this
//! file.

use crate::time_zones::is_known_time_zone;
use citadel_app_id::validate_app_id;
use serde_json::Value;
use std::collections::HashSet;

/// The node's own ordered app-tab list.
pub const APP_TABS_KEY: &str = "app_tabs";
/// The workspace's ordered app-tab list for nodes without their own.
pub const DEFAULT_APP_TABS_KEY: &str = "default_app_tabs";
/// The IANA zone of a workspace, or a node's override of it.
pub const TIME_ZONE_KEY: &str = "time_zone";
/// The Citadel App a document node opens in: its identity, set at creation and never changed.
pub const CITADEL_APP_KEY: &str = "citadel_app";
/// The most app tabs one list may name.
pub const MAX_APP_TABS: usize = 8;
/// What a workspace shows when it is provisioned, and what a workspace provisioned before tabs
/// existed is given once.
pub const PROVISIONED_DEFAULT_APP_TABS: &[&str] = &["net.avarok.calendar"];

/// Why a value under one of these keys is refused.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TabKeyRefusal {
    /// Not a list of strings.
    NotAList,
    /// More than `MAX_APP_TABS`.
    TooMany,
    /// One app twice.
    Repeated,
    /// An entry that is not an app id.
    NotAnAppId(String),
    /// Not one of `time_zones::TIME_ZONE_NAMES`.
    UnknownTimeZone,
}

impl std::fmt::Display for TabKeyRefusal {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NotAList => write!(f, "an app-tab list must be a list of app ids"),
            Self::TooMany => write!(f, "an app-tab list may name at most {MAX_APP_TABS} apps"),
            Self::Repeated => write!(f, "an app-tab list may name an app only once"),
            Self::NotAnAppId(id) => write!(f, "{id:?} is not an app id"),
            Self::UnknownTimeZone => write!(f, "the time zone is not an IANA zone name"),
        }
    }
}

impl std::error::Error for TabKeyRefusal {}

/// The app ids in an app-tab list, in order, or why it is refused.
pub fn check_app_tabs(value: &Value) -> Result<Vec<String>, TabKeyRefusal> {
    let items = value.as_array().ok_or(TabKeyRefusal::NotAList)?;
    if items.len() > MAX_APP_TABS {
        return Err(TabKeyRefusal::TooMany);
    }
    let mut seen = HashSet::new();
    let mut ids = Vec::with_capacity(items.len());
    for item in items {
        let id = item.as_str().ok_or(TabKeyRefusal::NotAList)?;
        validate_app_id(id).map_err(|_| TabKeyRefusal::NotAnAppId(id.to_string()))?;
        if !seen.insert(id) {
            return Err(TabKeyRefusal::Repeated);
        }
        ids.push(id.to_string());
    }
    Ok(ids)
}

/// Whether `value` is a time zone a workspace or node may be set to.
pub fn check_time_zone(value: &Value) -> Result<(), TabKeyRefusal> {
    match value.as_str() {
        Some(name) if is_known_time_zone(name) => Ok(()),
        _ => Err(TabKeyRefusal::UnknownTimeZone),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn a_list_of_distinct_app_ids_is_kept_in_order() {
        let ids = check_app_tabs(&json!(["net.avarok.calendar", "com.acme.kanban"])).unwrap();
        assert_eq!(ids, ["net.avarok.calendar", "com.acme.kanban"]);
        assert_eq!(check_app_tabs(&json!([])).unwrap(), Vec::<String>::new());
    }

    #[test]
    fn nine_tabs_are_refused_and_eight_are_not() {
        let ids = |n: usize| {
            json!((0..n)
                .map(|i| format!("com.acme.app{i}"))
                .collect::<Vec<_>>())
        };
        assert!(check_app_tabs(&ids(MAX_APP_TABS)).is_ok());
        assert_eq!(
            check_app_tabs(&ids(MAX_APP_TABS + 1)),
            Err(TabKeyRefusal::TooMany)
        );
    }

    #[test]
    fn a_repeated_or_malformed_entry_is_refused() {
        let repeated = json!(["com.acme.kanban", "com.acme.kanban"]);
        assert_eq!(check_app_tabs(&repeated), Err(TabKeyRefusal::Repeated));
        assert!(matches!(
            check_app_tabs(&json!(["Kanban"])),
            Err(TabKeyRefusal::NotAnAppId(_))
        ));
        assert_eq!(
            check_app_tabs(&json!("com.acme.kanban")),
            Err(TabKeyRefusal::NotAList)
        );
        assert_eq!(check_app_tabs(&json!([1])), Err(TabKeyRefusal::NotAList));
    }

    #[test]
    fn the_provisioned_default_is_itself_a_valid_list() {
        assert!(check_app_tabs(&json!(PROVISIONED_DEFAULT_APP_TABS)).is_ok());
    }

    #[test]
    fn a_time_zone_must_be_a_known_name() {
        assert!(check_time_zone(&json!("Europe/Berlin")).is_ok());
        assert_eq!(
            check_time_zone(&json!("CEST")),
            Err(TabKeyRefusal::UnknownTimeZone)
        );
        assert_eq!(
            check_time_zone(&json!(2)),
            Err(TabKeyRefusal::UnknownTimeZone)
        );
    }
}
