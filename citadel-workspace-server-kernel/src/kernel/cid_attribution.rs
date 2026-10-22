//! Which account each live connection belongs to, keyed by session CID.
//!
//! Command handling learns the actor from the per-connection task, but
//! `NodeResult::ObjectTransferHandle` arrives on a different branch of the
//! event loop and carries only a session CID. Without this map a file transfer
//! cannot be attributed to a user, and so cannot be authorised.
//!
//! A CID is permanent per account, so every reconnection of an account reuses
//! it. When a client reconnects, the SDK clears the old session and the new
//! one's `ConnectSuccess` is handled at once, but the old connection's task
//! only notices its channel has closed some milliseconds later -- after the new
//! connection has attributed the CID. Removing by CID alone let that late
//! teardown erase the live connection's attribution, and every transfer it made
//! from then on was declined as "account None". Each attribution therefore
//! carries the generation it was made in, and ending a connection removes the
//! entry only while it is still that connection's own.

use parking_lot::RwLock;
use std::collections::HashMap;
use std::sync::Arc;

#[derive(Default)]
struct Attributions {
    next_generation: u64,
    by_cid: HashMap<u64, (u64, String)>,
}

/// The CID-to-account map, shared by every clone of the kernel.
#[derive(Clone, Default)]
pub struct ConnectedAccounts {
    inner: Arc<RwLock<Attributions>>,
}

impl ConnectedAccounts {
    /// Attributes `cid` to `user_id` until the returned guard is dropped,
    /// replacing whatever an earlier connection on the same CID left there.
    pub fn attribute(&self, cid: u64, user_id: String) -> CidAttribution {
        let mut attributions = self.inner.write();
        let generation = attributions.next_generation;
        attributions.next_generation = generation.wrapping_add(1);
        attributions.by_cid.insert(cid, (generation, user_id));
        CidAttribution {
            accounts: self.clone(),
            cid,
            generation,
        }
    }

    /// The account the live connection on `cid` belongs to, if there is one.
    pub fn account_of(&self, cid: u64) -> Option<String> {
        self.inner
            .read()
            .by_cid
            .get(&cid)
            .map(|(_, user_id)| user_id.clone())
    }
}

/// Removes a connection's attribution when its task ends.
///
/// A `Drop` guard rather than a line at the end of the loop, because the task
/// has several exits (stream closed, send error, cancellation) and a stale
/// attribution is worse than none: the next connection on that CID would
/// otherwise inherit the previous one's authorisation.
pub struct CidAttribution {
    accounts: ConnectedAccounts,
    cid: u64,
    generation: u64,
}

impl Drop for CidAttribution {
    fn drop(&mut self) {
        let mut attributions = self.accounts.inner.write();
        let still_ours = matches!(
            attributions.by_cid.get(&self.cid),
            Some((generation, _)) if *generation == self.generation
        );
        if still_ours {
            attributions.by_cid.remove(&self.cid);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::ConnectedAccounts;

    const CID: u64 = 17_906_379_098_809_987_879;

    #[test]
    fn a_connection_is_attributed_while_it_lives() {
        let accounts = ConnectedAccounts::default();
        let connection = accounts.attribute(CID, "alice".to_string());
        assert_eq!(accounts.account_of(CID).as_deref(), Some("alice"));
        drop(connection);
        assert_eq!(accounts.account_of(CID), None);
    }

    /// The CI failure, in order: the reconnection attributes the CID, then the
    /// connection it replaced finishes tearing down.
    #[test]
    fn an_old_connection_ending_late_leaves_the_new_one_attributed() {
        let accounts = ConnectedAccounts::default();
        let old = accounts.attribute(CID, "alice".to_string());
        let new = accounts.attribute(CID, "alice".to_string());
        drop(old);
        assert_eq!(
            accounts.account_of(CID).as_deref(),
            Some("alice"),
            "the replaced connection's teardown erased the live connection's account"
        );
        drop(new);
        assert_eq!(accounts.account_of(CID), None);
    }

    #[test]
    fn an_old_connection_ending_first_leaves_the_new_one_attributed() {
        let accounts = ConnectedAccounts::default();
        let old = accounts.attribute(CID, "alice".to_string());
        drop(old);
        let _new = accounts.attribute(CID, "alice".to_string());
        assert_eq!(accounts.account_of(CID).as_deref(), Some("alice"));
    }

    #[test]
    fn other_cids_are_untouched() {
        let accounts = ConnectedAccounts::default();
        let _alice = accounts.attribute(CID, "alice".to_string());
        let bob = accounts.attribute(CID + 1, "bob".to_string());
        drop(bob);
        assert_eq!(accounts.account_of(CID).as_deref(), Some("alice"));
        assert_eq!(accounts.account_of(CID + 1), None);
    }
}
