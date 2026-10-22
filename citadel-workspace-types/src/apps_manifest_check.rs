//! Reading and validating a manifest: every field, each refused on its own.

use crate::apps::AppAudience;
use crate::apps_manifest::{
    AppIcon, AppManifest, Publisher, SdkRequirement, ABI_FIRST_PARTY_GLUE, ABI_V1, MANIFEST_FORMAT,
    MAX_MANIFEST_BYTES,
};
use crate::apps_manifest_check_parts::{check_artifact, check_capabilities, check_limits};
use base64::Engine;
use citadel_app_id::{validate_app_id, AppVersion};
use citadel_app_net_policy::{Scheme, TargetUrl};
use std::collections::HashSet;
use std::fmt;
use std::hash::Hash;

pub const MAX_NAME_CHARS: usize = 48;
pub const MAX_SUMMARY_CHARS: usize = 140;
pub const MAX_DESCRIPTION_CHARS: usize = 4000;
pub const MAX_PUBLISHER_NAME_CHARS: usize = 64;
pub const MAX_CONTACT_BYTES: usize = 256;
pub const MAX_ICON_BYTES: u64 = 64 * 1024;
pub const MAX_CATEGORIES: usize = 3;
pub const MAX_PREVIOUS_VERSIONS: usize = 32;
pub const MAX_AUDIENCE_NAMES: usize = 500;
pub const MAX_AUDIENCE_ROLES: usize = 64;
pub const PUBLIC_KEY_HEX_CHARS: usize = 3904;
const PNG_MAGIC: &[u8] = b"\x89PNG\r\n\x1a\n";

/// Which field of a manifest is malformed, and how.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ManifestRefusal {
    TooLarge,
    /// Not JSON, an unknown or duplicate field, a missing field, or a wrong type.
    Json(String),
    Format,
    Id,
    Version,
    Sdk(String),
    Publisher(String),
    Name,
    Summary,
    Description,
    Icon(String),
    Categories,
    Audience(String),
    Surfaces,
    Scopes,
    Capabilities(String),
    Limits(String),
    Artifact(String),
    PreviousVersions,
}

impl fmt::Display for ManifestRefusal {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::TooLarge => write!(f, "the manifest is larger than {MAX_MANIFEST_BYTES} bytes"),
            Self::Json(why) => write!(f, "the manifest is not a manifest: {why}"),
            Self::Sdk(why)
            | Self::Publisher(why)
            | Self::Icon(why)
            | Self::Audience(why)
            | Self::Capabilities(why)
            | Self::Limits(why)
            | Self::Artifact(why) => write!(f, "the manifest's {self:?} is refused: {why}"),
            other => write!(f, "the manifest's {other:?} field is malformed"),
        }
    }
}

impl std::error::Error for ManifestRefusal {}

pub(crate) fn distinct<T: Eq + Hash>(items: impl IntoIterator<Item = T>) -> bool {
    let mut seen = HashSet::new();
    items.into_iter().all(|item| seen.insert(item))
}

/// Plain text of 1..=`max` characters with no control characters but, if `newlines`, `\n`.
pub(crate) fn plain_text(text: &str, max: usize, newlines: bool) -> bool {
    let count = text.chars().count();
    (1..=max).contains(&count)
        && text.trim() == text
        && text
            .chars()
            .all(|c| !c.is_control() || (newlines && c == '\n'))
}

pub(crate) fn lower_hex(text: &str, len: usize) -> bool {
    text.len() == len
        && text
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

pub(crate) fn https_url(text: &str, max: usize) -> bool {
    text.len() <= max && TargetUrl::parse(text).is_ok_and(|url| url.scheme == Scheme::Https)
}

/// An id a scope or audience names: 1..=128 printable ASCII bytes, no `/`.
pub(crate) fn scope_id(id: &str) -> bool {
    crate::apps::InstallScope::Node(id.to_string())
        .scope_key()
        .is_some()
}

impl AppManifest {
    /// The manifest in `bytes`, or the first field that is wrong.
    pub fn from_bytes(bytes: &[u8]) -> Result<Self, ManifestRefusal> {
        if bytes.len() > MAX_MANIFEST_BYTES {
            return Err(ManifestRefusal::TooLarge);
        }
        let manifest: Self =
            serde_json::from_slice(bytes).map_err(|why| ManifestRefusal::Json(why.to_string()))?;
        manifest.validate()?;
        Ok(manifest)
    }

    /// Every field, in order; the first that is wrong is the answer.
    pub fn validate(&self) -> Result<(), ManifestRefusal> {
        if self.format != MANIFEST_FORMAT {
            return Err(ManifestRefusal::Format);
        }
        validate_app_id(&self.id).map_err(|_| ManifestRefusal::Id)?;
        let version = AppVersion::parse(&self.version).map_err(|_| ManifestRefusal::Version)?;
        check_sdk(&self.sdk)?;
        check_publisher(&self.publisher)?;
        if !plain_text(&self.name, MAX_NAME_CHARS, false) {
            return Err(ManifestRefusal::Name);
        }
        if !plain_text(&self.summary, MAX_SUMMARY_CHARS, false) {
            return Err(ManifestRefusal::Summary);
        }
        if !plain_text(&self.description, MAX_DESCRIPTION_CHARS, true) {
            return Err(ManifestRefusal::Description);
        }
        check_icon(&self.icon)?;
        let categories = &self.categories;
        if categories.is_empty() || categories.len() > MAX_CATEGORIES || !distinct(categories) {
            return Err(ManifestRefusal::Categories);
        }
        check_audience(&self.audience)?;
        if !distinct(&self.surfaces) {
            return Err(ManifestRefusal::Surfaces);
        }
        if self.scopes.is_empty() || !distinct(&self.scopes) {
            return Err(ManifestRefusal::Scopes);
        }
        check_capabilities(&self.id, &self.capabilities)?;
        check_limits(&self.limits)?;
        check_artifact(&self.artifact)?;
        if let Some(previous) = &self.previous_versions {
            let older = |v: &String| AppVersion::parse(v).is_ok_and(|v| v < version);
            let ok = previous.len() <= MAX_PREVIOUS_VERSIONS
                && previous.iter().all(older)
                && distinct(previous);
            if !ok {
                return Err(ManifestRefusal::PreviousVersions);
            }
        }
        Ok(())
    }
}

fn check_sdk(sdk: &SdkRequirement) -> Result<(), ManifestRefusal> {
    let refuse = |why: &str| Err(ManifestRefusal::Sdk(why.to_string()));
    if sdk.abi != ABI_V1 && sdk.abi != ABI_FIRST_PARTY_GLUE {
        return refuse("unknown abi");
    }
    let Ok(min) = AppVersion::parse(&sdk.min) else {
        return refuse("min is not a version");
    };
    let ceiling_ok = match sdk.max.strip_suffix(".x") {
        Some(major) => {
            AppVersion::parse(&format!("{major}.0.0")).is_ok_and(|m| m.major >= min.major)
        }
        None => AppVersion::parse(&sdk.max).is_ok_and(|max| max >= min),
    };
    if !ceiling_ok {
        return refuse("max is neither a version nor N.x at or above min");
    }
    Ok(())
}

fn check_publisher(publisher: &Publisher) -> Result<(), ManifestRefusal> {
    let refuse = |why: &str| Err(ManifestRefusal::Publisher(why.to_string()));
    if !plain_text(&publisher.name, MAX_PUBLISHER_NAME_CHARS, false) {
        return refuse("name");
    }
    if !lower_hex(&publisher.mldsa65_public_key, PUBLIC_KEY_HEX_CHARS) {
        return refuse("mldsa65_public_key is not 3904 lowercase hex characters");
    }
    if !https_url(&publisher.contact, MAX_CONTACT_BYTES) {
        return refuse("contact is not an https URL");
    }
    Ok(())
}

fn check_icon(icon: &AppIcon) -> Result<(), ManifestRefusal> {
    let refuse = |why: &str| Err(ManifestRefusal::Icon(why.to_string()));
    if icon.max_bytes == 0 || icon.max_bytes > MAX_ICON_BYTES {
        return refuse("max_bytes is not within 1..=65536");
    }
    // Bound the decode before doing it: base64 is 4 characters per 3 bytes.
    if icon.png_base64.len() > (icon.max_bytes as usize).div_ceil(3) * 4 {
        return refuse("larger than max_bytes");
    }
    let Ok(png) = base64::engine::general_purpose::STANDARD.decode(&icon.png_base64) else {
        return refuse("not standard padded base64");
    };
    if png.len() > icon.max_bytes as usize {
        return refuse("larger than max_bytes");
    }
    if !png.starts_with(PNG_MAGIC) {
        return refuse("not a PNG");
    }
    Ok(())
}

fn check_audience(audience: &AppAudience) -> Result<(), ManifestRefusal> {
    let refuse = |why: &str| Err(ManifestRefusal::Audience(why.to_string()));
    let names_ok = |names: &Vec<String>, max: usize| {
        !names.is_empty()
            && names.len() <= max
            && names.iter().all(|n| scope_id(n))
            && distinct(names)
    };
    match audience {
        AppAudience::Global {} | AppAudience::Workspace {} => Ok(()),
        AppAudience::NodeViewers { node_id } | AppAudience::NodeTreeViewers { node_id } => {
            if scope_id(node_id) {
                Ok(())
            } else {
                refuse("node_id")
            }
        }
        AppAudience::Members { usernames } if names_ok(usernames, MAX_AUDIENCE_NAMES) => Ok(()),
        AppAudience::Roles { role_ids } if names_ok(role_ids, MAX_AUDIENCE_ROLES) => Ok(()),
        _ => refuse("an empty, oversized, repeated or malformed list"),
    }
}
