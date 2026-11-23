//! The files an app opens (`opens` in its manifest) and how that declaration is checked.
//!
//! One rule for every app, signed or built into the page: canonical extensions (lower-case
//! ASCII letters and digits, no dot, refused rather than normalised), the surface an opened file
//! is shown in, which must be one the app paints (its handler), and an explicit size ceiling.

use crate::apps_manifest::AppSurface;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Extensions one app may declare.
pub const MAX_OPENS_EXTENSIONS: usize = 64;
/// Characters in one extension.
pub const MAX_EXTENSION_CHARS: usize = 16;
/// The largest file any app may ask to be handed: the page's cap on a pulled file.
pub const MAX_OPEN_FILE_BYTES: u64 = 256 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(deny_unknown_fields)]
pub struct FileOpens {
    /// `[a-z0-9]{1,16}`, without a dot, each once; 1 to `MAX_OPENS_EXTENSIONS`.
    pub extensions: Vec<String>,
    /// Where an opened file is shown: one of the app's `surfaces`.
    pub surface: AppSurface,
    /// The largest file the host hands over, 1 to `MAX_OPEN_FILE_BYTES`. A u64 because the
    /// client decodes `max_bytes` as a bigint wherever it appears.
    pub max_bytes: u64,
}

fn extension_problem(extension: &str) -> Option<String> {
    if extension.is_empty() {
        return Some("an empty extension".into());
    }
    if extension.len() > MAX_EXTENSION_CHARS {
        return Some(format!(
            "an extension longer than {MAX_EXTENSION_CHARS} characters"
        ));
    }
    if extension.starts_with('.') {
        return Some(format!("\"{extension}\" starts with a dot"));
    }
    if extension.chars().any(|c| c.is_ascii_uppercase()) {
        return Some(format!("\"{extension}\" is not lower-case"));
    }
    if !extension
        .bytes()
        .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit())
    {
        return Some(format!(
            "\"{extension}\" holds a character other than a-z and 0-9"
        ));
    }
    None
}

/// Why `opens` is refused for an app painting `surfaces`, or None when it stands.
pub fn opens_problem(opens: &FileOpens, surfaces: &[AppSurface]) -> Option<String> {
    let count = opens.extensions.len();
    if count == 0 || count > MAX_OPENS_EXTENSIONS {
        return Some(format!(
            "{count} extensions, not 1 to {MAX_OPENS_EXTENSIONS}"
        ));
    }
    if let Some(why) = opens.extensions.iter().find_map(|e| extension_problem(e)) {
        return Some(why);
    }
    if !crate::apps_manifest_check::distinct(&opens.extensions) {
        return Some("an extension is listed twice".into());
    }
    if !surfaces.contains(&opens.surface) {
        return Some(
            "its surface is not one the app paints, so nothing would show an opened file".into(),
        );
    }
    if opens.max_bytes == 0 || opens.max_bytes > MAX_OPEN_FILE_BYTES {
        return Some(format!("max_bytes is not within 1..={MAX_OPEN_FILE_BYTES}"));
    }
    None
}
