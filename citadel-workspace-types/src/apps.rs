//! Citadel Apps: third-party wasm apps a workspace installs, and what each install may do.
//!
//! An app is a signed `manifest.json` (`apps_manifest`) and `app.wasm`. An install
//! (`AppInstall`) runs it for a scope (`InstallScope`) with the capabilities its installer
//! granted (`Capability`). What a call may actually do is decided at the time of the call by the
//! kernel (`kernel::apps::rules`): the install's grant, narrowed to what the installer may still
//! grant, what the acting member may do themselves, and where the install reaches. Who may see
//! and be given an app at all is its audience (`AppAudience`).
//!
//! The request protocol is `apps_protocol`; the hidden required-apps header of a document is
//! `apps_md_header`. Types only: the store and the request handler live in the kernel.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;
use ts_rs::TS;

/// What an install may be granted: the SDK's closed list (`citadel-app-sdk-types`), so the
/// manifest's `cap` strings, the install record and the guest ABI name one set. A capability
/// that is not there cannot be asked for, granted or called.
///
/// Never capabilities, and never in the SDK: roles, secure links, telemetry, workspace
/// configuration, sign-in, keys, support.
pub use citadel_app_sdk_types::Capability;

pub use crate::apps_peer as peer;

/// Whether a manifest entry for `cap` lists `hosts`.
pub fn takes_hosts(cap: Capability) -> bool {
    matches!(cap, Capability::NetHost | Capability::NetServer)
}

/// Where an install runs.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum InstallScope {
    /// Every member: the same as `NodeTree` of the workspace root.
    Workspace,
    /// This node only.
    Node(String),
    /// This node and every node below it.
    NodeTree(String),
    /// These members.
    Users(Vec<String>),
    /// "Just for me": the installer only.
    SelfOnly(String),
}

/// The manifest's name for each kind of scope (`scopes`: which an app supports).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum ScopeKind {
    Workspace,
    Node,
    NodeTree,
    Users,
    #[serde(rename = "self")]
    SelfOnly,
}

/// The longest node id or username a scope may name.
pub const MAX_SCOPE_ID_BYTES: usize = 128;

impl InstallScope {
    pub fn kind(&self) -> ScopeKind {
        match self {
            Self::Workspace => ScopeKind::Workspace,
            Self::Node(_) => ScopeKind::Node,
            Self::NodeTree(_) => ScopeKind::NodeTree,
            Self::Users(_) => ScopeKind::Users,
            Self::SelfOnly(_) => ScopeKind::SelfOnly,
        }
    }

    /// The key storage and internal HTTP address this scope by: `workspace`, `node:<id>`,
    /// `tree:<id>`, `self:<username>`, or `users:` and 32 hex of the digest of the sorted,
    /// distinct usernames (so the same people in any order are one scope). None for a scope
    /// naming an id that is empty, longer than `MAX_SCOPE_ID_BYTES`, or not printable ASCII
    /// without `/`, and for an empty `Users`.
    pub fn scope_key(&self) -> Option<String> {
        let id_ok = |id: &str| {
            !id.is_empty()
                && id.len() <= MAX_SCOPE_ID_BYTES
                && id.bytes().all(|b| b.is_ascii_graphic() && b != b'/')
        };
        match self {
            Self::Workspace => Some("workspace".to_string()),
            Self::Node(id) if id_ok(id) => Some(format!("node:{id}")),
            Self::NodeTree(id) if id_ok(id) => Some(format!("tree:{id}")),
            Self::SelfOnly(user) if id_ok(user) => Some(format!("self:{user}")),
            Self::Users(users) if !users.is_empty() && users.iter().all(|u| id_ok(u)) => {
                let distinct: BTreeSet<&str> = users.iter().map(String::as_str).collect();
                let joined = distinct.into_iter().collect::<Vec<_>>().join("\n");
                let digest = hex::encode(Sha256::digest(joined.as_bytes()));
                Some(format!("users:{}", &digest[..32]))
            }
            _ => None,
        }
    }
}

/// Who may see and be given an app. A listing outside the viewer's audience cannot be
/// enumerated, and an install may only reach people inside it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum AppAudience {
    // `{}` rather than unit variants: serde lets a unit variant of an internally tagged enum
    // carry unknown fields whatever `deny_unknown_fields` says, and the manifest is strict.
    /// Anyone, in any workspace (the global catalogue).
    Global {},
    /// Every member of the workspace.
    Workspace {},
    /// Whoever can view this node (grants on a level above count).
    NodeViewers { node_id: String },
    /// Whoever can view this node or any node below it.
    NodeTreeViewers { node_id: String },
    /// These members.
    Members { usernames: Vec<String> },
    /// Whoever holds one of these workspace roles.
    Roles { role_ids: Vec<String> },
}
