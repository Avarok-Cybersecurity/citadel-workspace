//! Structured measurements an agent uploads through opt-in telemetry, beside its log lines.
//!
//! A metric entry is a `TelemetryEntry` at `TelemetryLevel::Metric` whose `metric` holds the
//! measurement. It carries the peer's CID (`TelemetryEntry::peer_cid`), so issues between two
//! peers can be traced, and never an address: NAT behaviour is reported as its translation
//! models only.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// The metric format this build writes and, on a server, stores. A server names it in
/// `MyConsent::metric_format`; an agent uploads metric entries only to a server naming this
/// one, because a server built before metrics existed refuses the whole batch they ride in.
pub const TELEMETRY_METRIC_FORMAT_VERSION: u32 = 1;

/// What a metric entry measured.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum TelemetryMetric {
    /// How one P2P path-upgrade attempt ended.
    PathReport(PathReport),
}

/// One upgrade attempt of a P2P connection: the path it attached and why every stage that did
/// not connect failed. Mirrors the protocol's `PathAttemptOutcome`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PathReport {
    /// 1 for a connection's first attempt; each retry or re-arm adds one.
    pub attempt: u32,
    /// The protocol's name for the plan (`DirectOnly`, `DirectThenTurn`, `TurnOnly`,
    /// `ServerOnly`), passed through so a plan this build does not know is still reported.
    pub plan: String,
    /// The path the attempt attached; `ServerRelay` when it attached none.
    pub path: PathTaken,
    /// On a TURN path, whether both peers relayed through their own allocation.
    pub relayed_both: bool,
    /// From coordination to the route attaching; `None` when it attached none.
    #[ts(type = "bigint | null")]
    pub time_to_connect_ms: Option<u64>,
    /// Every stage, in order, including those not tried.
    pub stages: Vec<PathStageReport>,
    pub local_nat: NatClassReport,
    pub peer_nat: NatClassReport,
}

/// The path carrying a P2P connection.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum PathTaken {
    Direct,
    Turn,
    ServerRelay,
}

/// How one stage of an attempt ended.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PathStageReport {
    /// The protocol's name for the stage (`Coordination`, `Direct`, `Turn`).
    pub stage: String,
    /// The protocol's name for why it did not connect (`PunchFailed`, `NotConfigured`, ...);
    /// `None` when it connected.
    pub failure: Option<String>,
    /// Zero for a stage that was not tried.
    #[ts(type = "bigint")]
    pub elapsed_ms: u64,
}

/// A NAT's translation models, without any address.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct NatClassReport {
    pub ip_translation: NatTranslation,
    pub port_translation: NatTranslation,
    pub ipv6_enabled: bool,
}

/// How a NAT maps an address or a port. `Constant` applies to IP addresses and
/// `DeltaConstantOffset` to ports; the rest to both.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum NatTranslation {
    Identity,
    Constant,
    DeltaConstantOffset,
    DeltaIndependentOffset,
    Unpredictable,
}
