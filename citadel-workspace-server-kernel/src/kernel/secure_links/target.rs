//! What a secure link may point at: a same-origin, in-app path to one of the app's routes.
//!
//! Checked when a link is made and again before a resolve hands it out, so a stored record that
//! somehow holds anything else is never sent to a browser to navigate to. An allowlist: the path
//! is one of the routes below, and every byte is printable ASCII, which rules out a scheme
//! (`javascript:` needs a path that is not one of these), another origin (`//host`, `/\host`),
//! and the tabs and newlines that URL parsers strip.

/// The longest target accepted, in bytes.
pub const MAX_TARGET_BYTES: usize = 2048;

/// The app routes a link may open, with no parameters in the path itself.
const ROUTES: [&str; 3] = ["/workspace", "/messages", "/directory"];
/// The one parameterised route: `/groups/<group id>`.
const GROUP_ROUTE: &str = "/groups/";

/// Why a target is refused, in words fit to show its creator.
pub fn validate_target(target: &str) -> Result<(), String> {
    if target.is_empty() || target.len() > MAX_TARGET_BYTES {
        return Err(format!(
            "A link target must be 1 to {MAX_TARGET_BYTES} bytes"
        ));
    }
    if !target.bytes().all(|b| (0x21..=0x7e).contains(&b)) {
        return Err("A link target may contain only printable ASCII, no spaces".to_string());
    }
    if target.contains('\\') {
        return Err("A link target may not contain a backslash".to_string());
    }
    let path = path_of(target);
    if path.starts_with("//") || !path.starts_with('/') {
        return Err("A link target must be a path in this app".to_string());
    }
    if ROUTES.contains(&path) || is_group_route(path) {
        if let Some(query) = query_of(target) {
            node_id_in(query)?;
        }
        return Ok(());
    }
    Err("A link may open the workspace, messages, a group or the directory only".to_string())
}

/// The node a `/workspace` target opens, when it names one (`nodeId=`). `None` for every other
/// route: messages, the directory and peer-to-peer groups are not things the server can see.
pub fn target_node_id(target: &str) -> Result<Option<String>, String> {
    if path_of(target) != "/workspace" {
        return Ok(None);
    }
    match query_of(target) {
        Some(query) => node_id_in(query),
        None => Ok(None),
    }
}

fn path_of(target: &str) -> &str {
    let end = target.find(['?', '#']).unwrap_or(target.len());
    &target[..end]
}

fn query_of(target: &str) -> Option<&str> {
    let start = target.find('?')? + 1;
    let rest = &target[start..];
    let end = rest.find('#').unwrap_or(rest.len());
    Some(&rest[..end])
}

fn is_group_route(path: &str) -> bool {
    path.strip_prefix(GROUP_ROUTE).is_some_and(|id| {
        !id.is_empty()
            && id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b'%'))
            && id != "."
            && id != ".."
    })
}

/// The decoded `nodeId` of a query, refusing a query that names more than one.
fn node_id_in(query: &str) -> Result<Option<String>, String> {
    let mut found = None;
    for pair in query.split('&') {
        let Some(value) = pair.strip_prefix("nodeId=") else {
            continue;
        };
        if found.is_some() {
            return Err("A link target may name one node only".to_string());
        }
        let decoded = percent_decode(value)?;
        if decoded.is_empty() {
            return Err("A link target names an empty node".to_string());
        }
        found = Some(decoded);
    }
    Ok(found)
}

fn percent_decode(value: &str) -> Result<String, String> {
    let bad = || "A link target has a malformed escape".to_string();
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'%' => {
                let hex = value.get(i + 1..i + 3).ok_or_else(bad)?;
                // `from_str_radix` alone takes a leading `+`, which no escape has.
                if !hex.bytes().all(|b| b.is_ascii_hexdigit()) {
                    return Err(bad());
                }
                out.push(u8::from_str_radix(hex, 16).map_err(|_| bad())?);
                i += 3;
            }
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            b => {
                out.push(b);
                i += 1;
            }
        }
    }
    String::from_utf8(out).map_err(|_| bad())
}
