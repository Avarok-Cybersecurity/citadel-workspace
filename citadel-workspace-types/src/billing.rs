//! "Plan & billing" over a member's session: `OpenBillingPortal`, answered with
//! `BillingPortal(BillingPortalAnswer)`.
//!
//! Who may open it is the server's decision, from the session's own account: the kernel asks
//! whether that account holds EditWorkspaceConfig at the workspace root, and a caller without it
//! is refused with `Error`, as every other permission-gated request is. The request carries
//! nothing a page could forge -- no CID, no workspace, no flag. Which subscription is opened is
//! the host's: a hosted tenant's object opens its own tenant's, and a server with no billing host
//! (a self-hosted one) answers `Error` that it has none.

use custom_debug::Debug;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// What the host answered an admitted `OpenBillingPortal`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum BillingPortalAnswer {
    /// A Stripe billing portal session for this workspace's subscription. The URL is a bearer
    /// link to the subscription, so it goes to the caller alone and is never logged.
    Opened {
        #[debug(with = crate::secret_debug_fmt)]
        portal_url: String,
    },
    /// The workspace is on the Free plan: there is no subscription to manage.
    NoSubscription,
    /// The host has no billing, or no portal configuration, to open one with.
    NotConfigured,
    /// The host could not be asked, or failed; asking again may succeed.
    Unavailable { reason: String },
}

#[cfg(test)]
mod tests {
    use super::BillingPortalAnswer;

    #[test]
    fn the_wire_names_are_the_ones_the_ui_reads() {
        let opened = BillingPortalAnswer::Opened {
            portal_url: "https://billing.stripe.com/p/session/x".into(),
        };
        assert_eq!(
            serde_json::to_string(&opened).unwrap(),
            r#"{"Opened":{"portal_url":"https://billing.stripe.com/p/session/x"}}"#
        );
        assert_eq!(
            serde_json::to_string(&BillingPortalAnswer::NoSubscription).unwrap(),
            r#""NoSubscription""#
        );
    }

    #[test]
    fn the_portal_url_never_prints() {
        let printed = format!(
            "{:?}",
            BillingPortalAnswer::Opened {
                portal_url: "https://billing.stripe.com/p/session/secret".into(),
            }
        );
        assert!(!printed.contains("secret"), "{printed}");
        assert!(printed.contains("<redacted>"), "{printed}");
    }
}
