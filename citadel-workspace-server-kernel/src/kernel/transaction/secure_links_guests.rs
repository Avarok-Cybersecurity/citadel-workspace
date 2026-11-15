//! The booking-guest grants' I/O (Calendar design §3.6.4): giving a guest `ViewContent` on one
//! node, as a direct grant on their account (`User.permissions`, read by
//! `check_entity_permission`), and taking back what a link gave when the link goes. What is
//! granted and to whom is decided in `kernel::secure_links::guests`; this only writes it.
//!
//! Each write is made under `lock_workspaces`, as every other write to an account is. The caller
//! holds `LINKS_LOCK`, which is always taken first.

use super::BackendTransactionManager;
use crate::kernel::secure_links::guests::grants_to_revoke;
use crate::kernel::secure_links::records::GuestGrant;
use citadel_logging::info;
use citadel_sdk::prelude::{NetworkError, Ratchet};
use citadel_workspace_types::structs::Permission;

impl<R: Ratchet + Send + Sync + 'static> BackendTransactionManager<R> {
    /// Gives `user` `ViewContent` on `node`, recorded as the link's grant; or, when they hold it
    /// directly already, records that the link gave nothing.
    pub(crate) async fn grant_guest_view(
        &self,
        user_id: &str,
        node: &str,
        link_id: &str,
    ) -> Result<GuestGrant, NetworkError> {
        let _workspaces = self.lock_workspaces().await;
        let Some(mut user) = self.get_user(user_id).await? else {
            return Err(NetworkError::msg("A booking guest has no account"));
        };
        let granted = user
            .permissions
            .entry(node.to_string())
            .or_default()
            .insert(Permission::ViewContent);
        if granted {
            self.insert_user(user_id.to_string(), user).await?;
        }
        info!(target: "citadel", "Secure link {link_id} admitted {user_id} as a booking guest of node {node} (granted: {granted})");
        Ok(GuestGrant {
            user: user_id.to_string(),
            node: node.to_string(),
            granted,
        })
    }

    /// Takes back the `ViewContent` grants a link gave its guests. An account since removed has
    /// nothing to take back.
    pub(crate) async fn revoke_guest_views(
        &self,
        guests: &[GuestGrant],
        link_id: &str,
    ) -> Result<(), NetworkError> {
        let revoking = grants_to_revoke(guests);
        if revoking.is_empty() {
            return Ok(());
        }
        let _workspaces = self.lock_workspaces().await;
        for (user_id, node) in revoking {
            let Some(mut user) = self.get_user(user_id).await? else {
                continue;
            };
            let Some(held) = user.permissions.get_mut(node) else {
                continue;
            };
            held.remove(&Permission::ViewContent);
            if held.is_empty() {
                user.permissions.remove(node);
            }
            self.insert_user(user_id.to_string(), user).await?;
            info!(target: "citadel", "Secure link {link_id} went: {user_id} is no longer a booking guest of node {node}");
        }
        Ok(())
    }
}
