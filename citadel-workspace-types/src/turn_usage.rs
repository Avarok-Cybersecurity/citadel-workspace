//! TURN bytes an agent reports to its server for the host's relay quota.
//!
//! Only an agent sees its TURN traffic: the relay is a third party's, and the bytes never pass
//! through the Citadel server. Each agent therefore reports its own connections' growth, and a
//! hosted server adds it to the tenant's `turn_bytes`, in the same quota as the bytes the server
//! relays itself.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// The most bytes one report may claim in either direction. An agent splits a larger growth
/// across several reports; a larger claim is refused whole, so one report cannot exhaust the
/// workspace's quota. Many reports are bounded by the host's per-member cap
/// (`TurnUsageRefusal::MemberHourlyCap`).
pub const MAX_TURN_USAGE_REPORT_BYTES: u64 = 8 * 1024 * 1024 * 1024;

/// One report: bytes sent and received through TURN since the previous one.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct TurnUsage {
    #[ts(type = "bigint")]
    pub tx_bytes: u64,
    #[ts(type = "bigint")]
    pub rx_bytes: u64,
}

/// Why the host refused a report whole: nothing of it was counted.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum TurnUsageRefusal {
    /// The member's reports this hour would pass the plan's per-member hourly ceiling
    /// (billing/tiers.json `paths.turn_gb_per_member_hour`), so one member's agent cannot run
    /// up the workspace's relay overage.
    MemberHourlyCap {
        #[ts(type = "bigint")]
        cap_bytes: u64,
        /// What the member's reports this hour already counted.
        #[ts(type = "bigint")]
        counted_bytes: u64,
        /// What this report claimed.
        #[ts(type = "bigint")]
        claimed_bytes: u64,
    },
    /// The host could not count it (its meter failed); nothing of it was counted.
    HostFailed,
}

impl TurnUsage {
    /// Both directions together, or why the report is refused.
    pub fn total(&self) -> Result<u64, String> {
        for (direction, bytes) in [("sent", self.tx_bytes), ("received", self.rx_bytes)] {
            if bytes > MAX_TURN_USAGE_REPORT_BYTES {
                return Err(format!(
                    "a TURN usage report claims {bytes} bytes {direction}, over \
                     {MAX_TURN_USAGE_REPORT_BYTES}"
                ));
            }
        }
        Ok(self.tx_bytes + self.rx_bytes)
    }
}
