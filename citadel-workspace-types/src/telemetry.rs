//! The Telemetry Service's wire types: what an agent uploads, what an admin reads.
//!
//! Telemetry is opt-in per user per workspace and stored in the workspace's own backend. The
//! agent redacts every line before it leaves the machine; the server stores what it is given
//! and never prints it, because every request is debug-logged (`entries` prints its length).

use crate::terms::{CurrentTerms, MyConsent};
use custom_debug::Debug;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

pub use crate::telemetry_reads::*;
pub use crate::turn_usage::TurnUsage;

/// The `TelemetryBatch::format_version` this server reads. A batch naming another is refused.
pub const TELEMETRY_BATCH_FORMAT_VERSION: u32 = 1;
/// Largest serialised batch the server stores, in bytes. One batch is one stored segment.
pub const MAX_TELEMETRY_BATCH_BYTES: usize = 256 * 1024;
/// Most entries one batch may carry.
pub const MAX_TELEMETRY_BATCH_ENTRIES: usize = 2_000;
/// Most records one `ListTelemetry` page returns.
pub const MAX_TELEMETRY_PAGE_RECORDS: u32 = 500;
/// Retention a workspace has until its admin sets a policy.
pub const DEFAULT_TELEMETRY_RETENTION_DAYS: u32 = 30;
/// Per-user storage a workspace has until its admin sets a policy.
pub const DEFAULT_TELEMETRY_PER_USER_BYTES: u64 = 20 * 1024 * 1024;
/// The longest retention an admin may set.
pub const MAX_TELEMETRY_RETENTION_DAYS: u32 = 90;
/// The most per-user storage an admin may set.
pub const MAX_TELEMETRY_PER_USER_BYTES: u64 = 50 * 1024 * 1024;
/// The longest a support-access grant may run from the moment it is set.
pub const MAX_SUPPORT_ACCESS_GRANT_MS: u64 = 30 * 24 * 60 * 60 * 1000;
/// Access-log rows kept; the oldest is dropped first.
pub const MAX_TELEMETRY_ACCESS_LOG_ENTRIES: usize = 1_000;

/// The policy a workspace runs under until its admin sets one.
pub const DEFAULT_TELEMETRY_POLICY: TelemetryPolicy = TelemetryPolicy {
    retention_days: DEFAULT_TELEMETRY_RETENTION_DAYS,
    per_user_bytes: DEFAULT_TELEMETRY_PER_USER_BYTES,
};

/// Warnings, errors and metrics are collected. Ordered, so `min_level` filters: a metric is
/// below every log level, so `Warn` and `Error` filters leave metrics out.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum TelemetryLevel {
    /// A measurement, in `TelemetryEntry::metric`, not a log line.
    Metric,
    Warn,
    Error,
}

/// One log line, already redacted by the agent, or one metric (`TelemetryLevel::Metric`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct TelemetryEntry {
    /// Milliseconds since the Unix epoch, by the agent's clock.
    #[ts(type = "bigint")]
    pub time_ms: u64,
    pub level: TelemetryLevel,
    /// The tracing target (module path).
    pub target: String,
    pub message: String,
    /// The peer this line concerns, kept so issues between peers can be traced.
    #[ts(type = "bigint | null")]
    pub peer_cid: Option<u64>,
    /// Exactly when `level` is `Metric`: what was measured. Absent from older agents' entries.
    pub metric: Option<crate::telemetry_metric::TelemetryMetric>,
}

// The signature custom_debug's `with` calls: the field's own type by reference.
#[allow(clippy::ptr_arg)]
fn entries_len_fmt(entries: &Vec<TelemetryEntry>, f: &mut std::fmt::Formatter) -> std::fmt::Result {
    write!(f, "<{} entries>", entries.len())
}

/// What an agent uploads for one session.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct TelemetryBatch {
    /// Must equal `TELEMETRY_BATCH_FORMAT_VERSION`.
    pub format_version: u32,
    pub agent_version: String,
    pub os: String,
    #[debug(with = entries_len_fmt)]
    pub entries: Vec<TelemetryEntry>,
}

/// Why an upload was not stored. The agent pauses until the state changes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum TelemetryUploadRefusal {
    /// The user has not opted in.
    ConsentOff,
    /// The user opted in under terms that have since changed.
    TermsOutdated,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum TelemetryRequest {
    /// Any signed-in user. Both versions must be the current ones (`GetTerms`).
    AcceptTerms {
        platform_version: u32,
        workspace_version: Option<u32>,
    },
    GetTerms,
    GetMyConsent,
    /// Enabling needs current terms. Disabling deletes the caller's telemetry.
    SetTelemetryConsent {
        enabled: bool,
    },
    /// Refused (`UploadRefused`) without consent under the current terms.
    UploadTelemetry {
        batch: TelemetryBatch,
    },
    /// `Permission::ViewTelemetry`. Recorded in the access log.
    ListTelemetry {
        filter: TelemetryFilter,
        page: TelemetryPage,
    },
    /// Deletes the caller's rows only.
    DeleteMyTelemetry,
    /// `Permission::ViewTelemetry`.
    GetTelemetrySettings,
    /// `Permission::EditWorkspaceConfig`; within the platform maxima.
    SetTelemetryPolicy {
        retention_days: u32,
        #[ts(type = "bigint")]
        per_user_bytes: u64,
    },
    /// `Permission::EditWorkspaceConfig`. `until_ms` is required to enable, at most
    /// `MAX_SUPPORT_ACCESS_GRANT_MS` ahead.
    SetSupportAccess {
        enabled: bool,
        #[ts(type = "bigint | null")]
        until_ms: Option<u64>,
    },
    /// `Permission::ViewTelemetry`. Newest first.
    ListTelemetryAccessLog,
    /// `Permission::EditWorkspaceConfig`. Every change bumps the workspace terms version;
    /// `None` removes the workspace terms.
    SetWorkspaceTerms {
        text: Option<String>,
    },
    /// Any signed-in user's agent: the TURN bytes its peer connections moved since its last
    /// report, for the host's relay quota. Metering, not diagnostics, so not consent-gated.
    /// Sent only to a server whose consent answer says it meters TURN (`MyConsent::meters_turn`).
    ReportTurnUsage {
        usage: TurnUsage,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum TelemetryResponse {
    Terms(CurrentTerms),
    Consent(MyConsent),
    Uploaded { stored_entries: u32 },
    UploadRefused(TelemetryUploadRefusal),
    Page(TelemetryPageResult),
    Deleted { segments: u32 },
    Settings(TelemetrySettings),
    AccessLog(Vec<TelemetryAccessLogEntry>),
    TurnUsageRecorded,
}
