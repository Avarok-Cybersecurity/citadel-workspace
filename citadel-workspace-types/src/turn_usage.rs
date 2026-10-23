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
/// workspace's quota. It does not stop a member's agent from sending many: see the report.
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
