//! The manifest's capability list, limits and artifact.

use crate::apps::Capability;
use crate::apps_manifest::{AppLimits, ArtifactLocation, ArtifactRef, CapabilityRequest};
use crate::apps_manifest_check::{distinct, https_url, lower_hex, plain_text, ManifestRefusal};
use citadel_app_id::validate_app_id;
use citadel_app_net_policy::{Egress, NetGrant, METHODS};

pub const MAX_WHY_CHARS: usize = 200;
pub const MAX_CALL_TARGETS: usize = 16;
pub const MAX_ROUTE_BYTES: usize = 256;
/// 256 MiB of 64 KiB pages: the host's ceiling whatever a manifest asks.
pub const MAX_MEMORY_PAGES: u32 = 4096;
pub const MAX_CALL_RATE_PER_S: u32 = 200;
pub const MAX_FRAME_BUDGET_MS: u32 = 1000;
pub const MAX_STORAGE_USER_BYTES: u32 = 1024 * 1024;
pub const MAX_STORAGE_SCOPE_BYTES: u32 = 8 * 1024 * 1024;
pub const MAX_ARTIFACT_BYTES: u32 = 8 * 1024 * 1024;
pub const MAX_LOCATIONS: usize = 4;
pub const MAX_GITHUB_PATH_BYTES: usize = 256;

fn refuse<T>(why: String) -> Result<T, ManifestRefusal> {
    Err(ManifestRefusal::Capabilities(why))
}

/// `METHOD /path`: one of the six methods, then `/` and segments of `[A-Za-z0-9._~-]`, or
/// `:name`, the last of which may be `*`. No `.` or `..` segment.
pub fn is_route_pattern(route: &str) -> bool {
    let Some((method, path)) = route.split_once(' ') else {
        return false;
    };
    if route.len() > MAX_ROUTE_BYTES || !METHODS.contains(&method) || !path.starts_with('/') {
        return false;
    }
    if path == "/" {
        return true;
    }
    let segments: Vec<&str> = path[1..].split('/').collect();
    let last = segments.len() - 1;
    segments.iter().enumerate().all(|(i, segment)| {
        let literal = !segment.is_empty()
            && *segment != "."
            && *segment != ".."
            && segment
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"._~-".contains(&b));
        let param = segment.strip_prefix(':').is_some_and(|name| {
            !name.is_empty()
                && name
                    .bytes()
                    .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_')
        });
        literal || param || (i == last && *segment == "*")
    })
}

pub(crate) fn check_capabilities(
    app_id: &str,
    requests: &[CapabilityRequest],
) -> Result<(), ManifestRefusal> {
    if requests.is_empty() || !distinct(requests.iter().map(|r| r.cap)) {
        return refuse("the list is empty or names a capability twice".to_string());
    }
    for request in requests {
        let cap = request.cap;
        if !plain_text(&request.why, MAX_WHY_CHARS, false) {
            return refuse(format!("{cap:?}: why"));
        }
        if request.hosts.is_some() != cap.takes_hosts()
            || request.routes.is_some() != (cap == Capability::IhttpServe)
            || request.targets.is_some() != (cap == Capability::IhttpCall)
        {
            return refuse(format!(
                "{cap:?}: hosts, routes or targets where they do not belong"
            ));
        }
        if let Some(hosts) = &request.hosts {
            let entries: Vec<&str> = hosts.iter().map(String::as_str).collect();
            // The egress policy's own reading of a host list: explicit, at most eight.
            NetGrant::new(Egress::Server, &entries)
                .map_err(|why| ManifestRefusal::Capabilities(format!("{cap:?}: {why:?}")))?;
        }
        if let Some(routes) = &request.routes {
            let ok = !routes.is_empty()
                && routes.len() <= citadel_ihttp_types::MAX_ROUTES
                && routes.iter().all(|r| is_route_pattern(r))
                && distinct(routes);
            if !ok {
                return refuse(format!("{cap:?}: routes"));
            }
        }
        if let Some(targets) = &request.targets {
            let ok = targets.len() <= MAX_CALL_TARGETS
                && targets
                    .iter()
                    .all(|t| validate_app_id(t).is_ok() && t != app_id)
                && distinct(targets);
            if !ok {
                return refuse(format!("{cap:?}: targets"));
            }
        }
    }
    let has = |cap| requests.iter().any(|r| r.cap == cap);
    if has(Capability::NetHostPrivate) && !has(Capability::NetHost) {
        return refuse("net.host.private without net.host".to_string());
    }
    Ok(())
}

pub(crate) fn check_limits(limits: &AppLimits) -> Result<(), ManifestRefusal> {
    let within = |value: u32, max: u32| (1..=max).contains(&value);
    let checks = [
        (
            "memory_pages",
            within(limits.memory_pages, MAX_MEMORY_PAGES),
        ),
        (
            "max_call_rate_per_s",
            within(limits.max_call_rate_per_s, MAX_CALL_RATE_PER_S),
        ),
        (
            "frame_budget_ms",
            within(limits.frame_budget_ms, MAX_FRAME_BUDGET_MS),
        ),
        (
            "storage_user_bytes",
            limits.storage_user_bytes <= MAX_STORAGE_USER_BYTES,
        ),
        (
            "storage_scope_bytes",
            limits.storage_scope_bytes <= MAX_STORAGE_SCOPE_BYTES,
        ),
    ];
    match checks.iter().find(|(_, ok)| !ok) {
        Some((field, _)) => Err(ManifestRefusal::Limits(field.to_string())),
        None => Ok(()),
    }
}

fn github_part(part: &str) -> bool {
    (1..=100).contains(&part.len())
        && part != "."
        && part != ".."
        && part
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b))
}

fn location_ok(location: &ArtifactLocation) -> bool {
    match location {
        ArtifactLocation::Https { url } => https_url(url, 2048),
        ArtifactLocation::GithubPinned { repo, commit, path } => {
            let repo_ok = repo
                .split_once('/')
                .is_some_and(|(owner, name)| github_part(owner) && github_part(name));
            let path_ok = path.len() <= MAX_GITHUB_PATH_BYTES && path.split('/').all(github_part);
            repo_ok && lower_hex(commit, 40) && path_ok
        }
    }
}

pub(crate) fn check_artifact(artifact: &ArtifactRef) -> Result<(), ManifestRefusal> {
    let refuse = |why: &str| Err(ManifestRefusal::Artifact(why.to_string()));
    if !lower_hex(&artifact.sha256, 64) {
        return refuse("sha256 is not 64 lowercase hex characters");
    }
    if artifact.bytes == 0 || artifact.bytes > MAX_ARTIFACT_BYTES {
        return refuse("bytes is not within 1..=8 MiB");
    }
    let locations = &artifact.locations;
    if locations.is_empty() || locations.len() > MAX_LOCATIONS || !distinct(locations) {
        return refuse("locations: none, more than four, or repeated");
    }
    if !locations.iter().all(location_ok) {
        return refuse("a location is not an https URL or a pinned GitHub file");
    }
    Ok(())
}
