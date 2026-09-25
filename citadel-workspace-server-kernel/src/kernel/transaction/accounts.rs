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
}
