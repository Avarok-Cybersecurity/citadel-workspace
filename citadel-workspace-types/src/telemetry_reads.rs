//! The Telemetry Service's read-side wire types: what an admin, or Avarok support with the
//! admin's grant, lists and configures. Re-exported from `crate::telemetry`.

use crate::telemetry::{TelemetryEntry, TelemetryLevel};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// A stored line as an admin reads it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct TelemetryRecord {
    pub user_id: String,
    /// When the server stored the batch, in Unix milliseconds. Retention counts from here.
    #[ts(type = "bigint")]
    pub received_at_ms: u64,
    pub agent_version: String,
    pub os: String,
    pub entry: TelemetryEntry,
}

/// Every field narrows; `None` does not filter. Times compare against `TelemetryEntry::time_ms`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct TelemetryFilter {
    pub user_id: Option<String>,
    #[ts(type = "bigint | null")]
    pub peer_cid: Option<u64>,
    pub min_level: Option<TelemetryLevel>,
    #[ts(type = "bigint | null")]
    pub since_ms: Option<u64>,
    #[ts(type = "bigint | null")]
    pub until_ms: Option<u64>,
}

/// Newest first. `limit` is at most `MAX_TELEMETRY_PAGE_RECORDS`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct TelemetryPage {
    pub offset: u32,
    pub limit: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct TelemetryPageResult {
    pub records: Vec<TelemetryRecord>,
    pub has_more: bool,
}

/// How long and how much each user's telemetry is kept.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct TelemetryPolicy {
    pub retention_days: u32,
    #[ts(type = "bigint")]
    pub per_user_bytes: u64,
}

/// Whether Avarok support may read this workspace's telemetry, and until when.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct SupportAccess {
    pub enabled: bool,
    /// Unix milliseconds. `Some` exactly when `enabled`.
    #[ts(type = "bigint | null")]
    pub until_ms: Option<u64>,
}

/// What the admin's Telemetry section shows.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct TelemetrySettings {
    pub policy: TelemetryPolicy,
    pub max_retention_days: u32,
    #[ts(type = "bigint")]
    pub max_per_user_bytes: u64,
    pub support_access: SupportAccess,
}

/// Who read telemetry.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum TelemetryAccessor {
    Member { user_id: String },
    Support,
}

/// One read of this workspace's telemetry. Every read is recorded, by members and by support.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct TelemetryAccessLogEntry {
    #[ts(type = "bigint")]
    pub at_ms: u64,
    pub accessor: TelemetryAccessor,
    pub filter: TelemetryFilter,
    pub returned: u32,
}
