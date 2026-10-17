//! The secure-link decisions, pure: given the facts, what happens. The request handler gathers
//! the facts (permissions, roles, the stored record) and writes what these decide.

use super::records::LinkRecord;
use super::target::validate_target;
use crate::kernel::secret_eq::secrets_match;
use citadel_workspace_types::secure_links::{LinkGrant, LinkLifetime, SECURE_LINK_MAX_TTL_MS};
use std::collections::HashMap;

pub const MAX_LABEL_CHARS: usize = 120;
pub const MAX_GRANTS: usize = 16;
pub const MAX_NAMES_PER_GRANT: usize = 500;
pub const MAX_NAME_CHARS: usize = 128;

/// What the server knows about the person opening a link.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Visitor {
    pub user_id: String,
    /// A member of the workspace who is not banned. Nobody else is admitted by any grant.
    pub member: bool,
    /// Their workspace role id, if they hold one.
    pub role_id: Option<String>,
    /// For each node a grant names: whether they can view it.
    pub node_views: HashMap<String, bool>,
}

/// Whether any of `grants` admits `visitor`.
pub fn grant_admits(grants: &[LinkGrant], visitor: &Visitor) -> bool {
    if !visitor.member {
        return false;
    }
    let named = |names: &Vec<String>| names.contains(&visitor.user_id);
    grants.iter().any(|grant| match grant {
        LinkGrant::Members(names) => named(names),
        LinkGrant::Roles(ids) => visitor
            .role_id
            .as_ref()
            .is_some_and(|role| ids.contains(role)),
        LinkGrant::NodeViewers(node) => visitor.node_views.get(node).copied() == Some(true),
        LinkGrant::Workspace => true,
        LinkGrant::GroupSnapshot { members, .. } => named(members),
    })
}

/// The nodes `grants` name, for the handler to look up the visitor's view of.
pub fn granted_nodes(grants: &[LinkGrant]) -> Vec<&str> {
    grants
        .iter()
        .filter_map(|grant| match grant {
            LinkGrant::NodeViewers(node) => Some(node.as_str()),
            _ => None,
        })
        .collect()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ResolveDecision {
    /// Unknown, expired, not granted or no longer a valid target: one answer for all.
    Unavailable,
    /// Send them to the target; a one-time link is deleted first.
    Admit { burn: bool },
}

/// Whether `visitor` may open the link `presented_digest` names, as of `now_ms`.
pub fn decide_resolve(
    record: Option<&LinkRecord>,
    presented_digest: &str,
    visitor: &Visitor,
    now_ms: u64,
) -> ResolveDecision {
    // Compared whether or not a record was found, so a miss costs what a hit does.
    let matched = secrets_match(record.map_or("", |r| r.digest.as_str()), presented_digest);
    let Some(record) = record else {
        return ResolveDecision::Unavailable;
    };
    let admitted = matched
        && record.live_at(now_ms)
        && grant_admits(&record.grants, visitor)
        && validate_target(&record.target).is_ok();
    if admitted {
        ResolveDecision::Admit {
            burn: record.one_time,
        }
    } else {
        ResolveDecision::Unavailable
    }
}

/// When a link given `ttl_ms` from `now_ms` expires: never past `SECURE_LINK_MAX_TTL_MS`.
pub fn expiry_at(now_ms: u64, ttl_ms: u64) -> Result<u64, String> {
    if ttl_ms == 0 {
        return Err("A link must live for some time".to_string());
    }
    now_ms
        .checked_add(ttl_ms.min(SECURE_LINK_MAX_TTL_MS))
        .ok_or_else(|| "The server clock is out of range".to_string())
}

/// What `Create` asks for, with the facts the handler gathered about its sender.
pub struct CreateInput<'a> {
    pub may_share: bool,
    pub may_view_target: bool,
    pub target: &'a str,
    pub label: &'a str,
    pub grants: &'a [LinkGrant],
    pub lifetime: &'a LinkLifetime,
    pub now_ms: u64,
}

/// A link `Create` may make, less its token, id and digest.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewLink {
    pub label: String,
    pub one_time: bool,
    pub expires_ms: u64,
}

/// Said to a caller without `ShareSecureLinks`, whatever they sent.
pub const SHARE_DENIED: &str = "Permission denied: ShareSecureLinks required";

/// Whether the link may be made, or an error fit to show its creator. Permission first, so a
/// caller without it is refused the same way whatever they send; then the request's shape; then
/// the target. The limit is the store's to check, under its lock (`LinkUsage::admits_another`).
pub fn decide_create(input: &CreateInput<'_>) -> Result<NewLink, String> {
    if !input.may_share {
        return Err(SHARE_DENIED.to_string());
    }
    validate_target(input.target)?;
    let label = clean_label(input.label)?;
    validate_grants(input.grants)?;
    let (one_time, ttl_ms) = match input.lifetime {
        LinkLifetime::Expires { ttl_ms } => (false, *ttl_ms),
        LinkLifetime::OneTime { ttl_ms } => (true, *ttl_ms),
    };
    let expires_ms = expiry_at(input.now_ms, ttl_ms)?;
    if !input.may_view_target {
        return Err("You can only share a link to something you can see".to_string());
    }
    Ok(NewLink {
        label,
        one_time,
        expires_ms,
    })
}

fn clean_label(label: &str) -> Result<String, String> {
    let label = label.trim();
    if label.chars().count() > MAX_LABEL_CHARS {
        return Err(format!(
            "A link label may be at most {MAX_LABEL_CHARS} characters"
        ));
    }
    if label.chars().any(char::is_control) {
        return Err("A link label may not contain control characters".to_string());
    }
    Ok(label.to_string())
}

fn validate_grants(grants: &[LinkGrant]) -> Result<(), String> {
    if grants.is_empty() || grants.len() > MAX_GRANTS {
        return Err(format!(
            "A link names 1 to {MAX_GRANTS} groups of people who may open it"
        ));
    }
    for grant in grants {
        match grant {
            LinkGrant::Members(names) | LinkGrant::Roles(names) => validate_names(names)?,
            LinkGrant::GroupSnapshot { group_id, members } => {
                validate_name(group_id)?;
                validate_names(members)?;
            }
            LinkGrant::NodeViewers(node) => validate_name(node)?,
            LinkGrant::Workspace => {}
        }
    }
    Ok(())
}

fn validate_names(names: &[String]) -> Result<(), String> {
    if names.is_empty() || names.len() > MAX_NAMES_PER_GRANT {
        return Err(format!(
            "Each list of people names 1 to {MAX_NAMES_PER_GRANT}"
        ));
    }
    names.iter().try_for_each(|name| validate_name(name))
}

fn validate_name(name: &str) -> Result<(), String> {
    if name.is_empty()
        || name.chars().count() > MAX_NAME_CHARS
        || name.chars().any(char::is_control)
    {
        return Err(format!(
            "A name in a link's grants is 1 to {MAX_NAME_CHARS} characters, none of them control"
        ));
    }
    Ok(())
}
