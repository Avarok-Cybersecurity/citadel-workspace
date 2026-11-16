//! The SDK's query strings and path segments (Calendar design §3.8), both ways: the client builds
//! them and the Calendar's instance parses them with these, so a value that survives one survives
//! the other. Escaping keeps RFC 3986's unreserved characters and percent-encodes every other
//! UTF-8 byte; parsing is strict, refusing a malformed escape, a repeated or unknown name, or a
//! missing one, rather than guessing.

use crate::sdk::{FreeBusyQuery, Include, ListQuery, SdkCode, SdkRefusal};
use alloc::collections::BTreeMap;
use alloc::string::{String, ToString};
use alloc::vec::Vec;

/// The most members one free/busy query names.
pub const MAX_FREE_BUSY_USERS: usize = 50;

const HEX: &[u8; 16] = b"0123456789ABCDEF";

pub fn escape(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for b in text.bytes() {
        if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'.' | b'_' | b'~') {
            out.push(b as char);
        } else {
            out.push('%');
            out.push(HEX[(b >> 4) as usize] as char);
            out.push(HEX[(b & 0xf) as usize] as char);
        }
    }
    out
}

/// The text `escape` made, or `None` for a stray `%`, a bad hex digit, or bytes that are not UTF-8.
pub fn unescape(text: &str) -> Option<String> {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            let hex = |b: u8| (b as char).to_digit(16);
            let hi = hex(*bytes.get(i + 1)?)?;
            let lo = hex(*bytes.get(i + 2)?)?;
            out.push((hi * 16 + lo) as u8);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

fn bad(detail: &str) -> SdkRefusal {
    SdkRefusal::new(SdkCode::BadRequest, detail)
}

/// `name=value` pairs, each name once and one of `names`, every one of `names` present.
fn pairs(query: &str, names: &[&str]) -> Result<BTreeMap<String, String>, SdkRefusal> {
    let mut out = BTreeMap::new();
    for part in query.split('&').filter(|p| !p.is_empty()) {
        let (name, value) = part
            .split_once('=')
            .ok_or_else(|| bad("a query part without '='"))?;
        if !names.contains(&name) {
            return Err(bad("an unknown query name"));
        }
        let value = unescape(value).ok_or_else(|| bad("a malformed escape"))?;
        if out.insert(name.to_string(), value).is_some() {
            return Err(bad("a query name given twice"));
        }
    }
    match names.iter().find(|n| !out.contains_key(**n)) {
        Some(_) => Err(bad("a query name is missing")),
        None => Ok(out),
    }
}

fn instant(value: &str) -> Result<i64, SdkRefusal> {
    let ok = !value.is_empty() && value.bytes().all(|b| b.is_ascii_digit());
    ok.then(|| value.parse::<i64>().ok())
        .flatten()
        .ok_or_else(|| bad("an instant that is not milliseconds"))
}

fn range(from: &str, to: &str) -> Result<(i64, i64), SdkRefusal> {
    let (from, to) = (instant(from)?, instant(to)?);
    if to <= from {
        return Err(bad("the range ends before it starts"));
    }
    Ok((from, to))
}

fn node(value: &str) -> Result<String, SdkRefusal> {
    if value.is_empty() {
        return Err(bad("no node"));
    }
    Ok(value.to_string())
}

const INCLUDES: [(Include, &str); 3] = [
    (Include::Own, "own"),
    (Include::Inherited, "inherited"),
    (Include::Up, "up"),
];

pub fn list_query_string(q: &ListQuery) -> String {
    let include = INCLUDES
        .iter()
        .find(|(i, _)| *i == q.include)
        .map_or("own", |(_, n)| n);
    alloc::format!(
        "node={}&from={}&to={}&include={include}",
        escape(&q.node),
        q.from_ms,
        q.to_ms
    )
}

pub fn parse_list_query(query: &str) -> Result<ListQuery, SdkRefusal> {
    let p = pairs(query, &["node", "from", "to", "include"])?;
    let (from_ms, to_ms) = range(&p["from"], &p["to"])?;
    let include = INCLUDES
        .iter()
        .find(|(_, n)| *n == p["include"])
        .map(|(i, _)| *i)
        .ok_or_else(|| bad("include is own, inherited or up"))?;
    Ok(ListQuery {
        node: node(&p["node"])?,
        from_ms,
        to_ms,
        include,
    })
}

/// Usernames are escaped one by one, so a comma inside one is not a separator.
pub fn free_busy_query_string(q: &FreeBusyQuery) -> String {
    let users: Vec<String> = q.users.iter().map(|u| escape(u)).collect();
    alloc::format!(
        "node={}&users={}&from={}&to={}",
        escape(&q.node),
        users.join(","),
        q.from_ms,
        q.to_ms
    )
}

pub fn parse_free_busy_query(query: &str) -> Result<FreeBusyQuery, SdkRefusal> {
    let mut names: Vec<&str> = Vec::new();
    for part in query.split('&') {
        if let Some(list) = part.strip_prefix("users=") {
            names.extend(list.split(','));
        }
    }
    let users: Option<Vec<String>> = names
        .iter()
        .map(|u| unescape(u).filter(|u| !u.is_empty()))
        .collect();
    let users = users.ok_or_else(|| bad("a username that is empty or malformed"))?;
    if users.is_empty() || users.len() > MAX_FREE_BUSY_USERS {
        return Err(bad("between 1 and 50 users"));
    }
    let rest: Vec<&str> = query
        .split('&')
        .filter(|p| !p.starts_with("users="))
        .collect();
    if rest.len() + 1 != query.split('&').count() {
        return Err(bad("users given twice"));
    }
    let p = pairs(&rest.join("&"), &["node", "from", "to"])?;
    let (from_ms, to_ms) = range(&p["from"], &p["to"])?;
    Ok(FreeBusyQuery {
        node: node(&p["node"])?,
        users,
        from_ms,
        to_ms,
    })
}
