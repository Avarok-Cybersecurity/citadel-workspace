//! What the Telemetry Service stores, and under which keys.
//!
//! A Durable Object's SQLite stores a value of at most 2 MB, and a user may keep up to
//! `MAX_TELEMETRY_PER_USER_BYTES`, so one user's telemetry is many records: each upload is one
//! segment under its own key, listed (with its size and arrival time) in that user's index.
//! Caps and retention drop whole segments, oldest first, without reading them.

use citadel_workspace_types::telemetry::TelemetryEntry;
use serde::{Deserialize, Serialize};

macro_rules! telemetry_key {
    ($name:literal) => {
        concat!("citadel_workspace.telemetry.", $name)
    };
}

const PREFIX: &str = telemetry_key!("");

/// Every user who has segments stored.
pub(crate) const USERS_KEY: &str = telemetry_key!("users");
pub(crate) const POLICY_KEY: &str = telemetry_key!("policy");
pub(crate) const SUPPORT_ACCESS_KEY: &str = telemetry_key!("support_access");
pub(crate) const ACCESS_LOG_KEY: &str = telemetry_key!("access_log");
pub(crate) const WORKSPACE_TERMS_KEY: &str = "citadel_workspace.terms.workspace";

pub(crate) fn index_key(user_id: &str) -> String {
    format!("{PREFIX}index.{user_id}")
}

/// Unique per (user, seq): `seq` is digits only, so the last `.` always separates the two.
pub(crate) fn segment_key(user_id: &str, seq: u64) -> String {
    format!("{PREFIX}segment.{user_id}.{seq}")
}

pub(crate) fn consent_key(user_id: &str) -> String {
    format!("{PREFIX}consent.{user_id}")
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct SegmentMeta {
    pub seq: u64,
    pub received_at_ms: u64,
    pub bytes: u64,
}

/// One user's segments, oldest first.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct UserTelemetryIndex {
    pub next_seq: u64,
    pub segments: Vec<SegmentMeta>,
}

impl UserTelemetryIndex {
    /// The index of a user with nothing stored.
    pub(crate) fn empty() -> Self {
        Self {
            next_seq: 0,
            segments: Vec::new(),
        }
    }
}

/// One stored upload.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct StoredSegment {
    pub received_at_ms: u64,
    pub agent_version: String,
    pub os: String,
    pub entries: Vec<TelemetryEntry>,
}

/// A user's accepted terms and opt-in.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct ConsentRecord {
    pub accepted_platform_version: Option<u32>,
    pub accepted_workspace_version: Option<u32>,
    pub accepted_at_ms: Option<u64>,
    pub telemetry_enabled: bool,
    pub telemetry_changed_at_ms: Option<u64>,
}

impl ConsentRecord {
    /// A user who has accepted nothing and not opted in.
    pub(crate) fn none() -> Self {
        Self {
            accepted_platform_version: None,
            accepted_workspace_version: None,
            accepted_at_ms: None,
            telemetry_enabled: false,
            telemetry_changed_at_ms: None,
        }
    }
}

/// The admin's workspace terms. `version` counts every change, clearing included.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct WorkspaceTermsRecord {
    pub version: u32,
    pub text: Option<String>,
}
