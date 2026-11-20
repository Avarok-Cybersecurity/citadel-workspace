//! The node's P2P key-exchange identity (citadel-internal-service's kernel/p2p_kex): a session
//! signed in with the identity signs its stage of every P2P key exchange, and the key each peer
//! signed with is pinned beside the accounts. A node built without it signs and checks nothing,
//! so every P2P link it makes is unverified.
//!
//! The pins follow the account backend, as the identity's own record does (identity_setup.rs):
//! they persist exactly when the accounts they belong to do.

use citadel_internal_service::kernel::{p2p_kex, CitadelWorkspaceService};
use citadel_internal_service_connector::io_interface::IOInterface;
use citadel_sdk::prelude::{BackendType, P2pKexIdentities, Ratchet};

/// What `NodeBuilder::with_p2p_kex_identity` takes for `service`, pinning where `backend` keeps
/// its accounts. Once per service.
pub async fn kex_identity<T: IOInterface, R: Ratchet>(
    service: &CitadelWorkspaceService<T, R>,
    backend: &BackendType,
) -> Result<P2pKexIdentities, String> {
    service
        .p2p_kex_identity(p2p_kex::peer_key_store_for(backend)?)
        .await
}

#[cfg(all(test, unix))]
#[path = "p2p_kex_setup_tests.rs"]
mod tests;
