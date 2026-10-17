//! `GetIceServers`: short-lived relay (TURN) credentials for a member's agent.
//!
//! The kernel decides WHO may have relay servers; it never mints them. Minting is I/O against a
//! provider holding a long-lived API key, so it belongs to the host the kernel runs in, which
//! passes an `IceServerSource` when it builds the kernel (`run_server_on`). A kernel built with
//! none answers `IceServersUnavailable`: there is no fallback list and no default provider.

use citadel_workspace_types::ice::IceServer;
use citadel_workspace_types::roles::RoleDefinition;
use citadel_workspace_types::structs::Permission;
use citadel_workspace_types::WorkspaceProtocolResponse;
use std::sync::Arc;

/// Who the credentials are for. The host keys its cache and its rate limit on it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IceServerMember {
    pub user_id: String,
}

/// What a host hands back: the servers, and when their credentials stop working (unix seconds).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IceServerGrant {
    pub ice_servers: Vec<IceServer>,
    pub expires_at: u64,
}

/// The host minted nothing, and why, in words fit to show the member.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IceServersUnavailable(pub String);

/// The host capability that mints relay credentials.
#[async_trait::async_trait]
pub trait IceServerSource: Send + Sync {
    async fn mint(&self, member: &IceServerMember)
        -> Result<IceServerGrant, IceServersUnavailable>;
}

/// The capability as the kernel holds it: absent unless the host passed one.
pub type IceServerSourceHandle = Option<Arc<dyn IceServerSource>>;

/// Whether an account holding `role` in the workspace may have relay servers: a role that may
/// send messages. A Guest reads; relaying media is not reading. `None` is a removed account, a
/// non-member, or one whose role no longer exists, and all are refused.
pub fn may_have_ice_servers(role: Option<&RoleDefinition>) -> bool {
    role.is_some_and(|role| role.grants(Permission::SendMessages))
}

/// Said to a Guest, a removed account or a non-member. `IceServersUnavailable`, not `Error`: the
/// UI shows every `Error` as a failed operation, and a guest connecting peer-to-peer without a
/// relay has not failed at anything. It is still a refusal: nothing is minted.
pub(crate) const REFUSED: &str = "relay servers are not available for your role";
pub(crate) const NOT_CONFIGURED: &str = "this workspace server has no relay servers to offer";

/// The answer, once eligibility is known.
pub async fn answer(
    source: &IceServerSourceHandle,
    eligible: bool,
    user_id: &str,
) -> WorkspaceProtocolResponse {
    if !eligible {
        return WorkspaceProtocolResponse::IceServersUnavailable {
            reason: REFUSED.to_string(),
        };
    }
    let Some(source) = source else {
        return WorkspaceProtocolResponse::IceServersUnavailable {
            reason: NOT_CONFIGURED.to_string(),
        };
    };
    let member = IceServerMember {
        user_id: user_id.to_string(),
    };
    match source.mint(&member).await {
        Ok(grant) => WorkspaceProtocolResponse::IceServers {
            ice_servers: grant.ice_servers,
            expires_at: grant.expires_at,
        },
        Err(IceServersUnavailable(reason)) => {
            WorkspaceProtocolResponse::IceServersUnavailable { reason }
        }
    }
}
