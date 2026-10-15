//! Who connects with whom without asking: the workspace's messaging trust policy, each
//! member's own narrowing of it, and the rule that combines the two.
//!
//! The policy names a trusted root. Everyone within that node and below registers with and
//! accepts everyone else there automatically; a request from outside it is a stranger's, and
//! the member's `accepts_requests_from_strangers` governs it as before. `AllTrusted` is an
//! alias of trusting the workspace root: `trusted_root` is the only place that says so, and
//! every rule below goes through it.
//!
//! Pure. The tree relation is supplied by the caller as `within(node, ancestor)`, true when
//! `node` is `ancestor` or lies below it; nothing here reads storage.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// The id of the workspace every tree hangs from.
pub const WORKSPACE_ROOT_ID: &str = "workspace-root";
/// Key of the workspace policy in `Workspace.metadata`, and of a member's own in `User.metadata`.
pub const MESSAGING_TRUST_POLICY_KEY: &str = "messaging_trust_policy";
/// The policy of a workspace whose admin has set none: Slack-like, everyone connects.
pub const DEFAULT_MESSAGING_TRUST_POLICY: MessagingTrustPolicy = MessagingTrustPolicy::AllTrusted;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum MessagingTrustPolicy {
    /// Every connection is a request the other person answers.
    Strict,
    /// Everyone in the workspace. The same as `NodeLevelTrusted` on the workspace root.
    AllTrusted,
    /// Everyone within `node_id` and the nodes below it.
    NodeLevelTrusted { node_id: String },
}

impl MessagingTrustPolicy {
    /// The node whose subtree is trusted, or `None` when nobody is.
    pub fn trusted_root(&self) -> Option<&str> {
        match self {
            Self::Strict => None,
            Self::AllTrusted => Some(WORKSPACE_ROOT_ID),
            Self::NodeLevelTrusted { node_id } => Some(node_id),
        }
    }
}

/// The trusted root a member actually has: the narrower of the workspace's and their own.
///
/// `personal` is `None` when the member follows the workspace. When one root lies within the
/// other the deeper one wins; when neither contains the other, or either policy is `Strict`,
/// nobody is trusted.
pub fn effective_trusted_root<'a>(
    workspace: &'a MessagingTrustPolicy,
    personal: Option<&'a MessagingTrustPolicy>,
    within: impl Fn(&str, &str) -> bool,
) -> Option<&'a str> {
    let workspace_root = workspace.trusted_root()?;
    let Some(personal) = personal else {
        return Some(workspace_root);
    };
    let personal_root = personal.trusted_root()?;
    if within(personal_root, workspace_root) {
        Some(personal_root)
    } else if within(workspace_root, personal_root) {
        Some(workspace_root)
    } else {
        None
    }
}

/// Whether a member may choose `personal`: only ever the workspace's scope or less of it.
pub fn personal_is_within_workspace(
    workspace: &MessagingTrustPolicy,
    personal: Option<&MessagingTrustPolicy>,
    within: impl Fn(&str, &str) -> bool,
) -> bool {
    let Some(personal_root) = personal.and_then(MessagingTrustPolicy::trusted_root) else {
        return true;
    };
    workspace
        .trusted_root()
        .is_some_and(|workspace_root| within(personal_root, workspace_root))
}

/// What the settings screens show.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct MessagingTrustSettings {
    /// As stored, or `DEFAULT_MESSAGING_TRUST_POLICY` when nothing is.
    pub workspace: MessagingTrustPolicy,
    /// The caller's own choice; `None` follows the workspace.
    pub mine: Option<MessagingTrustPolicy>,
    /// The intersection of the two; `None` when the caller trusts nobody automatically.
    pub effective_root: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum MessagingTrustRequest {
    /// Any signed-in member.
    GetMessagingTrustSettings,
    /// `Permission::EditWorkspaceConfig`. A `NodeLevelTrusted` node must exist.
    SetWorkspaceMessagingTrust { policy: MessagingTrustPolicy },
    /// Any member, for themselves. Refused when wider than the workspace's scope.
    SetMyMessagingTrust {
        policy: Option<MessagingTrustPolicy>,
    },
    /// Whether the caller and `peer_username` connect without asking. Decided from the
    /// stored policies and the server's membership, never from a client's view of either.
    CheckMessagingTrust { peer_username: String },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum MessagingTrustResponse {
    Settings(MessagingTrustSettings),
    PeerTrust {
        peer_username: String,
        /// Both are within the caller's effective trusted root: the caller accepts the peer
        /// without asking, and registers with them unprompted.
        trusted: bool,
        /// Both are within the peer's: the peer's client will accept the caller unprompted.
        peer_trusts_caller: bool,
    },
}

#[cfg(test)]
mod tests {
    use super::*;

    /// ws ─┬─ eng ── backend
    ///     └─ sales
    fn within(node: &str, ancestor: &str) -> bool {
        let parent = |id: &str| match id {
            "eng" | "sales" => Some(WORKSPACE_ROOT_ID),
            "backend" => Some("eng"),
            _ => None,
        };
        let mut current = Some(node);
        while let Some(id) = current {
            if id == ancestor {
                return true;
            }
            current = parent(id);
        }
        false
    }

    fn node(id: &str) -> MessagingTrustPolicy {
        MessagingTrustPolicy::NodeLevelTrusted {
            node_id: id.to_string(),
        }
    }

    #[test]
    fn all_trusted_is_the_workspace_root() {
        assert_eq!(
            MessagingTrustPolicy::AllTrusted.trusted_root(),
            node(WORKSPACE_ROOT_ID).trusted_root()
        );
        assert_eq!(MessagingTrustPolicy::Strict.trusted_root(), None);
    }

    #[test]
    fn following_the_workspace_is_the_workspace() {
        let ws = node("eng");
        assert_eq!(effective_trusted_root(&ws, None, within), Some("eng"));
    }

    #[test]
    fn the_deeper_root_wins_either_way_round() {
        let all = MessagingTrustPolicy::AllTrusted;
        let eng = node("eng");
        let backend = node("backend");
        assert_eq!(
            effective_trusted_root(&all, Some(&eng), within),
            Some("eng")
        );
        assert_eq!(
            effective_trusted_root(&eng, Some(&all), within),
            Some("eng")
        );
        assert_eq!(
            effective_trusted_root(&eng, Some(&backend), within),
            Some("backend")
        );
    }

    #[test]
    fn disjoint_branches_or_strict_trust_nobody() {
        let eng = node("eng");
        let sales = node("sales");
        let strict = MessagingTrustPolicy::Strict;
        assert_eq!(effective_trusted_root(&eng, Some(&sales), within), None);
        assert_eq!(effective_trusted_root(&eng, Some(&strict), within), None);
        assert_eq!(effective_trusted_root(&strict, None, within), None);
        assert_eq!(effective_trusted_root(&strict, Some(&eng), within), None);
    }

    #[test]
    fn a_member_may_narrow_but_never_widen() {
        let eng = node("eng");
        let strict = MessagingTrustPolicy::Strict;
        let all = MessagingTrustPolicy::AllTrusted;
        assert!(personal_is_within_workspace(&eng, None, within));
        assert!(personal_is_within_workspace(&eng, Some(&strict), within));
        assert!(personal_is_within_workspace(
            &eng,
            Some(&node("backend")),
            within
        ));
        assert!(personal_is_within_workspace(&eng, Some(&eng), within));
        assert!(!personal_is_within_workspace(&eng, Some(&all), within));
        assert!(!personal_is_within_workspace(
            &eng,
            Some(&node("sales")),
            within
        ));
        assert!(!personal_is_within_workspace(&strict, Some(&eng), within));
        assert!(personal_is_within_workspace(&strict, Some(&strict), within));
    }
}
