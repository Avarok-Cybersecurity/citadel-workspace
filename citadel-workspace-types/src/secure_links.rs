//! Secure links: a random token the server maps to an in-app deep link, opened only by the
//! people the creator named, for a bounded time.
//!
//! A link hides where it points; it never grants anything. The visitor passes the link's grant
//! check and is then sent to the target, which enforces its own permissions as for anyone else.
//! The token is shown once, in `Created` or `Regenerated`; the server keeps only its digest.

use custom_debug::Debug;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// The longest a link may live, from creation or from its latest `Extend`: 30 days.
pub const SECURE_LINK_MAX_TTL_MS: u64 = 30 * 24 * 60 * 60 * 1000;

/// Who may open a link. A link carries one or more; a visitor passes if any admits them.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum LinkGrant {
    /// These usernames.
    Members(Vec<String>),
    /// Anyone holding one of these workspace roles, by role id.
    Roles(Vec<String>),
    /// Anyone who can view this node (`ViewContent` on it).
    NodeViewers(String),
    /// Every member of the workspace.
    Workspace,
    /// The members of a peer-to-peer group chat as the creator saw them. The server cannot see
    /// group chats, so this list is frozen when the link is made.
    GroupSnapshot {
        group_id: String,
        members: Vec<String>,
    },
}

/// How long a link lives. A one-time link is deleted when it is first opened by someone it
/// admits, and still expires if nobody does.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum LinkLifetime {
    Expires {
        #[ts(type = "bigint")]
        ttl_ms: u64,
    },
    OneTime {
        #[ts(type = "bigint")]
        ttl_ms: u64,
    },
}

/// A link as its owner sees it. Never carries the token.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct SecureLinkInfo {
    pub id: String,
    /// The in-app path the link opens, e.g. `/workspace?nodeId=…`.
    pub target: String,
    pub label: String,
    pub grants: Vec<LinkGrant>,
    pub one_time: bool,
    #[ts(type = "bigint")]
    pub created_ms: u64,
    #[ts(type = "bigint")]
    pub expires_ms: u64,
    pub uses: u32,
    #[ts(type = "bigint | null")]
    pub last_used_ms: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum SecureLinksRequest {
    /// `ShareSecureLinks`, and the ability to view the target where the server can tell.
    Create {
        target: String,
        label: String,
        grants: Vec<LinkGrant>,
        lifetime: LinkLifetime,
    },
    /// The caller's own live links, and their limit.
    List,
    /// The link's owner only, as are `Regenerate` and `Extend`.
    Delete { id: String },
    /// A new token for the same link; the old one stops working.
    Regenerate { id: String },
    /// Expire `ttl_ms` from now, at most `SECURE_LINK_MAX_TTL_MS`.
    Extend {
        id: String,
        #[ts(type = "bigint")]
        ttl_ms: u64,
    },
    /// Where `token` points, if the caller may open it.
    Resolve {
        #[debug(with = crate::secret_debug_fmt)]
        token: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum SecureLinksResponse {
    /// `token` is shown this once; the server keeps only its digest.
    Created {
        info: SecureLinkInfo,
        #[debug(with = crate::secret_debug_fmt)]
        token: String,
    },
    Regenerated {
        info: SecureLinkInfo,
        #[debug(with = crate::secret_debug_fmt)]
        token: String,
    },
    Extended {
        info: SecureLinkInfo,
    },
    Deleted {
        id: String,
    },
    /// The caller's live links. `live` is how many they hold; each member has `per_member` of
    /// their own, and links past that draw on the workspace's shared `pool`, of which
    /// `pool_used` is taken. `None` (JSON `null`) is no limit: only an unlimited workspace has it.
    Links {
        links: Vec<SecureLinkInfo>,
        live: u32,
        per_member: Option<u32>,
        pool: Option<u32>,
        pool_used: u32,
    },
    Resolved {
        target: String,
    },
    /// Unknown, expired, used up, not for this caller, or not this caller's to change: the same
    /// answer for each, so a probe learns nothing.
    LinkUnavailable,
    /// The caller has used their own allowance and the shared pool is full.
    LimitReached {
        per_member: u32,
        pool: u32,
    },
}
