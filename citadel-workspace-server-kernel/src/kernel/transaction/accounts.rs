//! Whether a username is an account registered on this server.
//!
//! Registration is the SDK's, not the kernel's: the kernel's `User` records are
//! written on first connect and by `AddMember`, so they cannot answer "does this
//! account exist" -- `AddMember` itself used to mint one for any name it was
//! given. The SDK derives a CID from the username (`username_to_cid`, the same
//! derivation its own registration and `find_target` use), and its account store
//! answers whether that CID is registered. On the Durable Object that store is
//! the `host_sql` backend (`account_exists`), natively whatever the node was
//! built with; both answer through the one `AccountManager` call below.

use super::BackendTransactionManager;
use citadel_sdk::prelude::{NetworkError, Ratchet};
use std::collections::HashSet;

impl<R: Ratchet + Send + Sync + 'static> BackendTransactionManager<R> {
    /// Whether `username` names an account registered on this server.
    ///
    /// Without a `NodeRemote` (the in-process test mode every backend read in
    /// this manager already branches on) there is no SDK account store, and the
    /// accounts that exist are exactly the `User` records the test injected.
    pub async fn account_is_registered(&self, username: &str) -> Result<bool, NetworkError> {
        let node_remote = self.node_remote.read().clone();
        match node_remote {
            Some(remote) => remote
                .account_manager()
                .hyperlan_cid_is_registered(citadel_types::user::username_to_cid(username))
                .await
                .map_err(|e| {
                    NetworkError::msg(format!("Could not look up the account '{username}': {e}"))
                }),
            None => Ok(self.get_user(username).await?.is_some()),
        }
    }

    /// The CIDs `username` has a mutual P2P registration with.
    ///
    /// The Citadel server records a registration once both sides agree
    /// (`register_hyperlan_p2p_as_server`); its account store is the source the
    /// SDK's `GetMutuals` answers from. Without a `NodeRemote` there is no
    /// account store and so no registration of any kind: the empty set is the
    /// true answer there, not a stand-in.
    pub async fn p2p_contacts_of(&self, username: &str) -> Result<HashSet<u64>, NetworkError> {
        let node_remote = self.node_remote.read().clone();
        let Some(remote) = node_remote else {
            return Ok(HashSet::new());
        };
        let peers = remote
            .account_manager()
            .get_hyperlan_peer_list(citadel_types::user::username_to_cid(username))
            .await
            .map_err(|e| {
                NetworkError::msg(format!("Could not read the contacts of '{username}': {e}"))
            })?;
        Ok(peers.unwrap_or_default().into_iter().collect())
    }

    /// `p2p_contacts_of` for deciding what to redact: a read that fails is
    /// logged and answered with no contacts, so a lookup error withholds a
    /// hidden profile rather than handing it to someone who may be a stranger.
    pub async fn contacts_for_redaction(&self, viewer: &str) -> HashSet<u64> {
        match self.p2p_contacts_of(viewer).await {
            Ok(contacts) => contacts,
            Err(e) => {
                citadel_logging::warn!(target: "citadel", "{e}; treating every hidden profile as hidden from {viewer}");
                HashSet::new()
            }
        }
    }
}
