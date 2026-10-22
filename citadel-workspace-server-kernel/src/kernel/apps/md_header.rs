//! Who may change a document's required-apps header, and the kernel's own writes to it.
//!
//! Pure. Only the kernel writes the header, when an `AppManage` and `EditMdx` holder installs an
//! app with `inject_requirement`; uninstalling removes exactly the entry that install wrote. An
//! edit by anyone without `AppManage` must carry the stored header byte for byte, so a person
//! who may edit a document cannot make it require (or stop requiring) an app.

use citadel_workspace_types::apps_md_header::{
    join, read_document, render_header, split, AppRequirement, AppsHeader, HeaderRefusal,
    RequirementSurface,
};

/// What an edit that changes the header without `AppManage` is told.
pub const HEADER_MANAGED: &str = "the apps header is managed by workspace admins";

/// Whether `incoming` may replace `stored`: always when the header line is unchanged (present
/// in both and identical, or absent from both), otherwise only for an `AppManage` holder.
pub fn check_header_edit(stored: &str, incoming: &str, may_manage: bool) -> Result<(), String> {
    if split(stored).0 == split(incoming).0 || may_manage {
        Ok(())
    } else {
        Err(HEADER_MANAGED.to_string())
    }
}

/// `content` with `app` required at `min`, or `None` when the header already names `app`: an
/// entry the kernel did not write stays as it is and is never recorded as the install's.
pub fn inject(content: &str, app: &str, min: &str) -> Result<Option<String>, HeaderRefusal> {
    let (header, body) = read_document(content)?;
    let mut require = header.map(|h| h.require).unwrap_or_default();
    if require.iter().any(|entry| entry.app == app) {
        return Ok(None);
    }
    require.push(AppRequirement {
        app: app.to_string(),
        min: min.to_string(),
        surface: RequirementSurface::None,
    });
    let line = render_header(&AppsHeader::normalized(require))?;
    Ok(Some(join(Some(&line), body)))
}

/// `content` without `app`'s entry, or `None` when it has none. A header left empty goes with
/// it, so the document is its body again.
pub fn remove(content: &str, app: &str) -> Result<Option<String>, HeaderRefusal> {
    let (header, body) = read_document(content)?;
    let Some(header) = header else {
        return Ok(None);
    };
    let before = header.require.len();
    let require: Vec<AppRequirement> = header
        .require
        .into_iter()
        .filter(|entry| entry.app != app)
        .collect();
    if require.len() == before {
        return Ok(None);
    }
    if require.is_empty() {
        return Ok(Some(body.to_string()));
    }
    let line = render_header(&AppsHeader { require })?;
    Ok(Some(join(Some(&line), body)))
}
