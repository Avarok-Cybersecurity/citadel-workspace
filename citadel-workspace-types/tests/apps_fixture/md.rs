//! The required-apps header lines the header tests share.

use citadel_workspace_types::apps_md_header::{AppRequirement, RequirementSurface};

pub const KANBAN: &str = r#"{/* @citadel-apps 1 {"require":[{"app":"com.acme.kanban","min":"1.2.0","surface":"none"}]} */}"#;
pub const TWO: &str = r#"{/* @citadel-apps 1 {"require":[{"app":"com.acme.kanban","min":"1.2.0","surface":"none"},{"app":"com.acme.lint","min":"0.9.0","surface":"none"}]} */}"#;

pub fn requirement(app: &str, min: &str) -> AppRequirement {
    AppRequirement {
        app: app.to_string(),
        min: min.to_string(),
        surface: RequirementSurface::None,
    }
}
