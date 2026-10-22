//! A document's hidden required-apps header: the first line of `mdx_content`, an MDX comment the
//! renderer shows nothing for.
//!
//! ```text
//! {/* @citadel-apps 1 {"require":[{"app":"com.acme.kanban","min":"1.2.0","surface":"none"}]} */}
//! ```
//!
//! Exactly one, on the first line, in exactly the form `render_header` writes: the JSON compact,
//! its entries sorted by app id with no app twice, no `*/` inside it (which would end the
//! comment early). Only the kernel writes it; an edit by anyone without `AppManage` must carry it
//! byte for byte. `split` and `join` are mirrored by the UI's `md-header.ts`, which is tested
//! against `bindings/md-header-fixtures.json`, generated from this module's tests.

use citadel_app_id::{validate_app_id, AppVersion};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use ts_rs::TS;

pub const APPS_HEADER_PREFIX: &str = "{/* @citadel-apps ";
pub const APPS_HEADER_SUFFIX: &str = " */}";
pub const APPS_HEADER_VERSION: u32 = 1;
pub const MAX_HEADER_BYTES: usize = 16 * 1024;
pub const MAX_REQUIREMENTS: usize = 32;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(deny_unknown_fields)]
pub struct AppsHeader {
    pub require: Vec<AppRequirement>,
}

/// A document needs `app` at version `min` or later. It never grants anything: a zone still runs
/// only where an install covers the viewer.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(deny_unknown_fields)]
pub struct AppRequirement {
    pub app: String,
    pub min: String,
    pub surface: RequirementSurface,
}

/// Header requirements do not paint; zones name their own app inline.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum RequirementSurface {
    #[serde(rename = "none")]
    None,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HeaderRefusal {
    TooLarge,
    /// Not `{/* @citadel-apps <v> <json> */}`.
    Shape,
    Version,
    /// `*/` inside the JSON would end the comment early.
    CommentTerminator,
    Json(String),
    Empty,
    TooMany,
    AppId,
    MinVersion,
    /// Not the exact form `render_header` writes (spacing, order, a repeated app).
    NotCanonical,
    /// A header line anywhere below the first line.
    SecondHeader,
}

/// The first line when it is a header candidate, and the rest. A first line that does not start
/// with `APPS_HEADER_PREFIX` is body, as is everything when there is no header.
pub fn split(content: &str) -> (Option<&str>, &str) {
    if !content.starts_with(APPS_HEADER_PREFIX) {
        return (None, content);
    }
    match content.split_once('\n') {
        Some((header, body)) => (Some(header), body),
        None => (Some(content), ""),
    }
}

/// `split`'s inverse: `join(split(c)) == c` for every document but one that is only a header
/// line, which comes back followed by the newline a header always has.
pub fn join(header: Option<&str>, body: &str) -> String {
    match header {
        Some(header) => format!("{header}\n{body}"),
        None => body.to_string(),
    }
}

/// The header in `line`, refused unless it is exactly what `render_header` writes for it.
pub fn parse_header(line: &str) -> Result<AppsHeader, HeaderRefusal> {
    if line.len() > MAX_HEADER_BYTES {
        return Err(HeaderRefusal::TooLarge);
    }
    let inner = line
        .strip_prefix(APPS_HEADER_PREFIX)
        .and_then(|rest| rest.strip_suffix(APPS_HEADER_SUFFIX))
        .ok_or(HeaderRefusal::Shape)?;
    let (version, json) = inner.split_once(' ').ok_or(HeaderRefusal::Shape)?;
    if version != APPS_HEADER_VERSION.to_string() {
        return Err(HeaderRefusal::Version);
    }
    if json.contains("*/") {
        return Err(HeaderRefusal::CommentTerminator);
    }
    let header: AppsHeader =
        serde_json::from_str(json).map_err(|why| HeaderRefusal::Json(why.to_string()))?;
    if render_header(&header)? != line {
        return Err(HeaderRefusal::NotCanonical);
    }
    Ok(header)
}

/// The header line for `header`: refused if empty, oversized or naming a malformed app or
/// version, or if its entries are not sorted by app id without repeats (`normalized` makes them
/// so).
pub fn render_header(header: &AppsHeader) -> Result<String, HeaderRefusal> {
    if header.require.is_empty() {
        return Err(HeaderRefusal::Empty);
    }
    if header.require.len() > MAX_REQUIREMENTS {
        return Err(HeaderRefusal::TooMany);
    }
    for entry in &header.require {
        validate_app_id(&entry.app).map_err(|_| HeaderRefusal::AppId)?;
        AppVersion::parse(&entry.min).map_err(|_| HeaderRefusal::MinVersion)?;
    }
    if !header.require.windows(2).all(|w| w[0].app < w[1].app) {
        return Err(HeaderRefusal::NotCanonical);
    }
    let json = serde_json::to_string(header).map_err(|why| HeaderRefusal::Json(why.to_string()))?;
    let line = format!("{APPS_HEADER_PREFIX}{APPS_HEADER_VERSION} {json}{APPS_HEADER_SUFFIX}");
    if line.len() > MAX_HEADER_BYTES {
        return Err(HeaderRefusal::TooLarge);
    }
    Ok(line)
}

/// A whole document: its header if it has one, and its body, which may not hold a second.
pub fn read_document(content: &str) -> Result<(Option<AppsHeader>, &str), HeaderRefusal> {
    let (line, body) = split(content);
    if body
        .lines()
        .any(|l| l.trim_start().starts_with(APPS_HEADER_PREFIX.trim_end()))
    {
        return Err(HeaderRefusal::SecondHeader);
    }
    let header = line.map(parse_header).transpose()?;
    Ok((header, body))
}

impl AppsHeader {
    /// These requirements as a header writes them: sorted by app, each app once, the higher
    /// `min` kept when one is named twice. Entries with a malformed version are kept as they are
    /// for `render_header` to refuse.
    pub fn normalized(requirements: impl IntoIterator<Item = AppRequirement>) -> Self {
        let mut by_app: BTreeMap<String, AppRequirement> = BTreeMap::new();
        for entry in requirements {
            let keep_existing = by_app.get(&entry.app).is_some_and(|existing| {
                match (
                    AppVersion::parse(&existing.min),
                    AppVersion::parse(&entry.min),
                ) {
                    (Ok(have), Ok(new)) => have >= new,
                    _ => false,
                }
            });
            if !keep_existing {
                by_app.insert(entry.app.clone(), entry);
            }
        }
        Self {
            require: by_app.into_values().collect(),
        }
    }
}
