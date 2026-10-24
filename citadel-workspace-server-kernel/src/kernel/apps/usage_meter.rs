//! What apps cost the workspace in bytes, as a port (design E7): bytes a server egress answer
//! brought in, and frames relayed between sessions as internal HTTP. The kernel reports each
//! use where it happens; what the host does with it is the host's.
//!
//! `CountingMeter` is the one implementation: it keeps a running total per session and kind and
//! logs each use for the operator. Nothing here bills: wiring a meter to a plan's overage is the
//! host's, and is not done.

use citadel_logging::info;
use parking_lot::Mutex;
use std::collections::HashMap;
use std::sync::Arc;

/// What a metered use was.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Usage {
    /// The body of a server egress (`net.server`) answer.
    EgressIn,
    /// One internal-HTTP frame the relay forwarded, as the sender encoded it.
    RelayIhttp,
}

/// Where the kernel reports usage. `cid` is the session that caused it, `None` for a request
/// that came without one.
pub trait UsageMeter: Send + Sync {
    fn add(&self, cid: Option<u64>, usage: Usage, bytes: u64);
}

/// The kernel's meter: the host's, set at bootstrap.
pub type UsageMeterHandle = Arc<dyn UsageMeter>;

/// Running totals per session and kind, and an operator log line per use.
#[derive(Debug, Default)]
pub struct CountingMeter {
    totals: Mutex<HashMap<(Option<u64>, Usage), u64>>,
}

impl CountingMeter {
    /// The total so far for `cid` and `usage`.
    pub fn total(&self, cid: Option<u64>, usage: Usage) -> u64 {
        self.totals.lock().get(&(cid, usage)).copied().unwrap_or(0)
    }
}

impl UsageMeter for CountingMeter {
    fn add(&self, cid: Option<u64>, usage: Usage, bytes: u64) {
        let total = {
            let mut totals = self.totals.lock();
            let total = totals.entry((cid, usage)).or_insert(0);
            *total = total.saturating_add(bytes);
            *total
        };
        info!(target: "citadel", "[APPS-USAGE] {usage:?} cid={cid:?} +{bytes} bytes, {total} in all");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn totals_are_kept_per_session_and_kind() {
        let meter = CountingMeter::default();
        meter.add(Some(1), Usage::EgressIn, 10);
        meter.add(Some(1), Usage::EgressIn, 5);
        meter.add(Some(1), Usage::RelayIhttp, 7);
        meter.add(Some(2), Usage::EgressIn, 1);
        assert_eq!(meter.total(Some(1), Usage::EgressIn), 15);
        assert_eq!(meter.total(Some(1), Usage::RelayIhttp), 7);
        assert_eq!(meter.total(Some(2), Usage::EgressIn), 1);
        assert_eq!(meter.total(None, Usage::EgressIn), 0);
    }
}
